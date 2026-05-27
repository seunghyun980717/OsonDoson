"""
Sign-to-Speech training with:
- sentence-level CTC loss
- token-level auxiliary classification loss from morpheme segments
"""
import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    BATCH_SIZE,
    CACHE_DIR,
    CHECKPOINTS_DIR,
    EPOCHS,
    GRAD_CLIP,
    LR,
    MAX_SEGMENT_FRAMES,
    TOKEN_AUX_LOSS_WEIGHT,
    TRAIN_CSV,
    VAL_CSV,
    SEGMENT_MANIFEST_DIR,
)
from sign_to_speech.dataset import get_or_build_vocab
from sign_to_speech.model import build_sign_model, ctc_beam_decode, ctc_greedy_decode


class CachedSignDataset(Dataset):
    def __init__(self, split: str, vocab, max_frames: int = 512):
        assert split in ("train", "val")
        csv_path = TRAIN_CSV if split == "train" else VAL_CSV

        self.split = split
        self.vocab = vocab
        self.max_frames = max_frames
        self.segment_map = self._load_segment_manifest(split)
        self.samples = self._load(csv_path)
        print(f"[{split}] loaded {len(self.samples)} samples (vocab={len(vocab)})")

    def _load_segment_manifest(self, split: str) -> dict[str, list[dict]]:
        manifest_path = SEGMENT_MANIFEST_DIR / f"{split}_segments.json"
        if not manifest_path.exists():
            from sign_to_speech.build_segment_manifest import build_segment_manifest

            print(f"[{split}] segment manifest missing -> building")
            build_segment_manifest()
        if not manifest_path.exists():
            return {}
        with open(manifest_path, encoding="utf-8") as f:
            return json.load(f)

    def _load(self, csv_path: Path):
        samples = []
        missing = []
        with open(csv_path, encoding="euc-kr") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) < 3 or not row[2].strip():
                    continue
                name = row[1].replace(".mp4", "")
                npy_path = CACHE_DIR / f"{name}.npy"
                if not npy_path.exists():
                    missing.append(name)
                    continue

                label_ids = self.vocab.encode(row[2].strip().split())
                raw_segments = self.segment_map.get(name, [])
                samples.append((name, npy_path, label_ids, raw_segments))

        if missing:
            print(f"  [WARN] cache missing for {len(missing)} samples")
        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        name, npy_path, label_ids, raw_segments = self.samples[idx]
        seq = np.load(npy_path)
        seq_len = min(len(seq), self.max_frames)
        seq = seq[:seq_len]

        segments = []
        for seg in raw_segments:
            gloss = seg["gloss"]
            label = self.vocab.stoi.get(gloss)
            if label is None or label <= 1:
                continue

            start = int(seg["start_frame"])
            end = int(seg["end_frame"])
            if start >= seq_len:
                continue
            end = min(end, seq_len, start + MAX_SEGMENT_FRAMES)
            if end <= start:
                continue
            segments.append({"start": start, "end": end, "label": label, "gloss": gloss})

        return (
            name,
            torch.from_numpy(seq),
            torch.tensor(label_ids, dtype=torch.long),
            segments,
        )

    @staticmethod
    def collate_fn(batch):
        names, kps, labels, segment_lists = zip(*batch)
        lengths = [k.shape[0] for k in kps]
        max_t = max(lengths)
        batch_size, dim = len(kps), kps[0].shape[1]

        kp_pad = torch.zeros(batch_size, max_t, dim)
        for i, (k, t) in enumerate(zip(kps, lengths)):
            kp_pad[i, :t] = k

        label_cat = torch.cat(labels)
        label_lens = [len(l) for l in labels]

        segments = []
        segment_targets = []
        for batch_idx, segs in enumerate(segment_lists):
            for seg in segs:
                segments.append(
                    {
                        "batch_idx": batch_idx,
                        "start": seg["start"],
                        "end": seg["end"],
                        "gloss": seg["gloss"],
                    }
                )
                segment_targets.append(seg["label"])

        return (
            list(names),
            kp_pad,
            torch.tensor(lengths, dtype=torch.long),
            label_cat,
            torch.tensor(label_lens, dtype=torch.long),
            segments,
            torch.tensor(segment_targets, dtype=torch.long),
        )


def wer(pred_seqs: list[str], tgt_seqs: list[str]) -> float:
    total_err = total_words = 0
    for pred, tgt in zip(pred_seqs, tgt_seqs):
        p, t = pred.split(), tgt.split()
        dp = list(range(len(t) + 1))
        for pi in p:
            new = [dp[0] + 1]
            for j, tj in enumerate(t):
                new.append(min(dp[j] + (pi != tj), dp[j + 1] + 1, new[-1] + 1))
            dp = new
        total_err += dp[-1]
        total_words += len(t)
    return total_err / max(total_words, 1)


def save_checkpoint(path: Path, epoch, model, optimizer, scheduler, val_loss, val_wer, best_val_loss, best_val_wer, vocab):
    torch.save(
        {
            "epoch": epoch,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "val_loss": val_loss,
            "val_wer": val_wer,
            "best_val_loss": best_val_loss,
            "best_val_wer": best_val_wer,
            "vocab": vocab.tokens,
            "model_type": type(model).__name__,
        },
        path,
    )


def find_last_checkpoint() -> Path | None:
    ckpts = sorted(
        CHECKPOINTS_DIR.glob("epoch_*.pt"),
        key=lambda p: int(p.stem.split("_")[1]),
    )
    return ckpts[-1] if ckpts else None


def _compute_losses(model, criterion_ctc, criterion_token, batch, vocab, device, decode_mode: str = "greedy"):
    _, kp, kp_lens, labels, label_lens, segments, segment_targets = batch
    kp = kp.to(device)
    kp_lens = kp_lens.to(device)
    labels = labels.to(device)
    label_lens = label_lens.to(device)

    log_probs, encoded = model(kp, lengths=kp_lens)
    ctc_loss = criterion_ctc(log_probs, labels, kp_lens, label_lens)

    token_loss = torch.tensor(0.0, device=device)
    token_acc = 0.0
    if len(segments) > 0:
        segment_logits = model.classify_segments(encoded, segments)
        segment_targets = segment_targets.to(device)
        token_loss = criterion_token(segment_logits, segment_targets)
        token_pred = segment_logits.argmax(dim=-1)
        token_acc = (token_pred == segment_targets).float().mean().item()

    total_loss = ctc_loss + TOKEN_AUX_LOSS_WEIGHT * token_loss

    preds = ctc_beam_decode(log_probs, vocab) if decode_mode == "beam" else ctc_greedy_decode(log_probs, vocab)
    tgt_strs = []
    offset = 0
    for ll in label_lens.tolist():
        tgt = " ".join(vocab.tokens[j] for j in labels[offset : offset + ll].tolist())
        tgt_strs.append(tgt)
        offset += ll

    return total_loss, ctc_loss, token_loss, token_acc, preds, tgt_strs


def run_epoch_train(model, loader, criterion_ctc, criterion_token, optimizer, device, vocab):
    model.train()
    total_loss = total_ctc = total_token = total_acc = 0.0
    n = len(loader)
    t0 = time.time()

    for i, batch in enumerate(loader):
        total, ctc, token, token_acc, _, _ = _compute_losses(
            model, criterion_ctc, criterion_token, batch, vocab, device, decode_mode="greedy"
        )

        optimizer.zero_grad()
        total.backward()
        nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
        optimizer.step()

        total_loss += total.item()
        total_ctc += ctc.item()
        total_token += token.item()
        total_acc += token_acc
        elapsed = time.time() - t0
        print(
            f"  [Train] {i+1:3d}/{n} loss={total_loss/(i+1):.4f} "
            f"ctc={total_ctc/(i+1):.4f} tok={total_token/(i+1):.4f} "
            f"tok_acc={total_acc/(i+1):.3f} {elapsed:.0f}s",
            end="\r",
            flush=True,
        )

    print()
    return total_loss / n


def run_epoch_val(model, loader, criterion_ctc, criterion_token, vocab, device):
    model.eval()
    total_loss = total_ctc = total_token = total_acc = 0.0
    pred_strs, tgt_strs = [], []
    n = len(loader)

    with torch.no_grad():
        for i, batch in enumerate(loader):
            total, ctc, token, token_acc, preds, targets = _compute_losses(
                model, criterion_ctc, criterion_token, batch, vocab, device, decode_mode="greedy"
            )
            total_loss += total.item()
            total_ctc += ctc.item()
            total_token += token.item()
            total_acc += token_acc
            pred_strs.extend(preds)
            tgt_strs.extend(targets)
            print(
                f"  [Val]   {i+1:3d}/{n} loss={total_loss/(i+1):.4f} "
                f"ctc={total_ctc/(i+1):.4f} tok={total_token/(i+1):.4f} "
                f"tok_acc={total_acc/(i+1):.3f}",
                end="\r",
                flush=True,
            )

    print()
    return total_loss / n, wer(pred_strs, tgt_strs)


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    if not CACHE_DIR.exists() or not any(CACHE_DIR.glob("*.npy")):
        print("[train] cache not found. Run `python -m sign_to_speech.precache` first.")
        return

    vocab = get_or_build_vocab(force=args.rebuild_vocab)
    train_ds = CachedSignDataset("train", vocab)
    val_ds = CachedSignDataset("val", vocab)

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=CachedSignDataset.collate_fn,
        num_workers=0,
        pin_memory=(device.type == "cuda"),
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=CachedSignDataset.collate_fn,
        num_workers=0,
        pin_memory=(device.type == "cuda"),
    )

    model = build_sign_model(vocab_size=len(vocab)).to(device)
    criterion_ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    criterion_token = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=4, factor=0.5)

    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    best_val_loss = float("inf")
    best_val_wer = float("inf")
    start_epoch = 1
    early_stop_count = 0

    if args.resume:
        ckpt_path = find_last_checkpoint()
        if ckpt_path:
            print(f"[resume] loading {ckpt_path.name}")
            ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
            model.load_state_dict(ckpt["model"])
            optimizer.load_state_dict(ckpt["optimizer"])
            scheduler.load_state_dict(ckpt["scheduler"])
            start_epoch = ckpt["epoch"] + 1
            best_val_loss = ckpt.get("best_val_loss", float("inf"))
            best_val_wer = ckpt.get("best_val_wer", ckpt.get("val_wer", float("inf")))
            print(f"  resume from epoch {ckpt['epoch']} best_loss={best_val_loss:.4f} best_wer={best_val_wer:.4f}")
        else:
            print("[resume] no checkpoint found, training from scratch")

    for epoch in range(start_epoch, args.epochs + 1):
        t_epoch = time.time()
        print(f"\n{'=' * 60}")
        print(f"Epoch {epoch:03d}/{args.epochs}")
        print(f"{'=' * 60}")

        train_loss = run_epoch_train(
            model, train_loader, criterion_ctc, criterion_token, optimizer, device, vocab
        )
        val_loss, val_wer = run_epoch_val(
            model, val_loader, criterion_ctc, criterion_token, vocab, device
        )

        scheduler.step(val_loss)
        lr_now = optimizer.param_groups[0]["lr"]
        elapsed = time.time() - t_epoch
        print(
            f"  train_loss={train_loss:.4f}  val_loss={val_loss:.4f}  "
            f"WER={val_wer:.3f}  lr={lr_now:.2e}  {elapsed:.0f}s"
        )

        improved = val_wer < best_val_wer
        if improved:
            best_val_loss = val_loss
            best_val_wer = val_wer
            early_stop_count = 0
            save_checkpoint(
                CHECKPOINTS_DIR / "best.pt",
                epoch,
                model,
                optimizer,
                scheduler,
                val_loss,
                val_wer,
                best_val_loss,
                best_val_wer,
                vocab,
            )
            print(f"  [BEST] updated best checkpoint: val_wer={val_wer:.4f} val_loss={val_loss:.4f}")
        else:
            early_stop_count += 1
            print(f"  [EARLY] no WER improvement ({early_stop_count}/{args.patience})")

        if epoch % 5 == 0:
            ckpt_name = CHECKPOINTS_DIR / f"epoch_{epoch:03d}.pt"
            save_checkpoint(
                ckpt_name,
                epoch,
                model,
                optimizer,
                scheduler,
                val_loss,
                val_wer,
                best_val_loss,
                best_val_wer,
                vocab,
            )
            print(f"  [CKPT] saved {ckpt_name.name}")

        if early_stop_count >= args.patience:
            print(f"  [EARLY STOP] patience reached at epoch {epoch}")
            break

    print("\nTraining complete")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--batch_size", type=int, default=BATCH_SIZE)
    parser.add_argument("--lr", type=float, default=LR)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--rebuild_vocab", action="store_true")
    parser.add_argument("--patience", type=int, default=8)
    args = parser.parse_args()
    train(args)
