"""
Sign-to-Speech (CTC) evaluation.

Examples:
    python -m sign_to_speech.evaluate
    python -m sign_to_speech.evaluate --ckpt checkpoints/epoch_050.pt
    python -m sign_to_speech.evaluate --split val --export_csv checkpoints/eval/my_val.csv
    python -m sign_to_speech.evaluate --n_sample 20 --pipeline
"""
import argparse
import csv
import random
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import CACHE_DIR, CHECKPOINTS_DIR
from sign_to_speech.dataset import Vocabulary
from sign_to_speech.model import build_sign_model, ctc_beam_decode, ctc_greedy_decode
from sign_to_speech.train import CachedSignDataset, wer


def load_model(ckpt_path: Optional[Path] = None):
    if ckpt_path is None:
        ckpt_path = CHECKPOINTS_DIR / "best.pt"
    if not ckpt_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {ckpt_path}")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    vocab = Vocabulary()
    vocab.tokens = ckpt["vocab"]
    vocab.stoi = {t: i for i, t in enumerate(vocab.tokens)}
    model = build_sign_model(vocab_size=len(vocab))
    model.load_state_dict(ckpt["model"])
    model.eval()

    saved_epoch = ckpt.get("epoch", "?")
    saved_val_loss = ckpt.get("val_loss", float("nan"))
    saved_val_wer = ckpt.get("val_wer", float("nan"))
    print(f"[evaluate] checkpoint: {ckpt_path.name}")
    print(f"  epoch={saved_epoch}  val_loss={saved_val_loss:.4f}  val_WER={saved_val_wer:.3f}")

    return model, vocab


def gloss_f1(pred_seqs: List[str], tgt_seqs: List[str]) -> Tuple[float, float, float]:
    """Token-set precision / recall / F1 averaged over samples."""
    p_sum = r_sum = f_sum = 0.0
    for pred, tgt in zip(pred_seqs, tgt_seqs):
        p_toks = set(pred.split())
        t_toks = set(tgt.split())
        if not p_toks and not t_toks:
            p_sum += 1.0
            r_sum += 1.0
            f_sum += 1.0
            continue
        tp = len(p_toks & t_toks)
        precision = tp / len(p_toks) if p_toks else 0.0
        recall = tp / len(t_toks) if t_toks else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        p_sum += precision
        r_sum += recall
        f_sum += f1
    n = max(len(pred_seqs), 1)
    return p_sum / n * 100, r_sum / n * 100, f_sum / n * 100


def sample_gloss_f1(pred: str, tgt: str) -> float:
    p_toks = set(pred.split())
    t_toks = set(tgt.split())
    if not p_toks and not t_toks:
        return 100.0
    tp = len(p_toks & t_toks)
    precision = tp / len(p_toks) if p_toks else 0.0
    recall = tp / len(t_toks) if t_toks else 0.0
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall) * 100


@torch.no_grad()
def run_full_eval(
    model,
    vocab: Vocabulary,
    split: str = "val",
    batch_size: int = 32,
    device: torch.device = torch.device("cpu"),
    decode_mode: str = "greedy",
) -> Tuple[float, float, float, float, List[Dict[str, object]]]:
    ds = CachedSignDataset(split, vocab)
    loader = DataLoader(
        ds,
        batch_size=batch_size,
        shuffle=False,
        collate_fn=CachedSignDataset.collate_fn,
        num_workers=0,
    )

    model.to(device)
    rows: List[Dict[str, object]] = []
    pred_strs: List[str] = []
    tgt_strs: List[str] = []
    n = len(loader)

    t0 = time.time()
    for i, (names, kp, kp_lens, labels, label_lens, _, _) in enumerate(loader):
        kp = kp.to(device)
        kp_lens = kp_lens.to(device)

        log_probs, _ = model(kp, lengths=kp_lens)
        preds = ctc_beam_decode(log_probs, vocab) if decode_mode == "beam" else ctc_greedy_decode(log_probs, vocab)
        pred_strs.extend(preds)

        batch_targets: List[str] = []
        offset = 0
        for ll in label_lens.tolist():
            tgt = " ".join(vocab.tokens[j] for j in labels[offset : offset + ll].tolist())
            batch_targets.append(tgt)
            offset += ll
        tgt_strs.extend(batch_targets)

        for name, pred, tgt in zip(names, preds, batch_targets):
            rows.append(
                {
                    "sample_id": name,
                    "split": split,
                    "pred_gloss": pred,
                    "target_gloss": tgt,
                    "exact_match": int(pred.strip() == tgt.strip()),
                    "sample_wer": round(wer([pred], [tgt]), 6),
                    "sample_f1": round(sample_gloss_f1(pred, tgt), 4),
                }
            )

        print(f"  [{i+1:3d}/{n}]", end="\r", flush=True)

    elapsed = time.time() - t0
    print(f"\n  evaluation done: {len(pred_strs)} samples ({elapsed:.1f}s)")

    wer_score = wer(pred_strs, tgt_strs)
    prec, rec, f1 = gloss_f1(pred_strs, tgt_strs)
    return wer_score, prec, rec, f1, rows


def write_eval_csv(rows: List[Dict[str, object]], csv_path: Path):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "sample_id",
                "split",
                "pred_gloss",
                "target_gloss",
                "exact_match",
                "sample_wer",
                "sample_f1",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"[evaluate] csv saved: {csv_path}")


def print_samples(
    rows: List[Dict[str, object]],
    n: int = 10,
    pipeline: bool = False,
    seed: int = 42,
):
    rng = random.Random(seed)
    samples = rng.sample(rows, min(n, len(rows)))

    if pipeline:
        from sign_to_speech.gloss_to_korean import gloss_to_korean

    print(f"\n{'='*60}")
    print(f"sample outputs: {len(samples)} (seed={seed})")
    print(f"{'='*60}")

    correct = 0
    for idx, row in enumerate(samples, 1):
        pred = str(row["pred_gloss"])
        tgt = str(row["target_gloss"])
        match = "O" if pred.strip() == tgt.strip() else "X"
        if pred.strip() == tgt.strip():
            correct += 1

        print(f"\n[{idx:02d}] {match}")
        print(f"  sample_id: {row['sample_id']}")
        print(f"  target:    {tgt or '(empty)'}")
        print(f"  pred:      {pred or '(empty)'}")
        print(f"  sample_WER={row['sample_wer']:.4f}  sample_F1={row['sample_f1']:.2f}")

        pred_set = set(pred.split())
        tgt_set = set(tgt.split())
        hit = pred_set & tgt_set
        miss = tgt_set - pred_set
        extra = pred_set - tgt_set
        if hit:
            print(f"  hit:       {' '.join(sorted(hit))}")
        if miss:
            print(f"  miss:      {' '.join(sorted(miss))}")
        if extra:
            print(f"  extra:     {' '.join(sorted(extra))}")

        if pipeline and pred.strip():
            korean = gloss_to_korean(pred)
            print(f"  ko:        {korean}")

    print(f"\n{'='*60}")
    print(f"exact match: {correct}/{len(samples)}")


def evaluate(
    ckpt_path: Optional[Path] = None,
    split: str = "val",
    batch_size: int = 32,
    n_sample: int = 0,
    pipeline: bool = False,
    seed: int = 42,
    export_csv: Optional[Path] = None,
    decode_mode: str = "greedy",
):
    if not CACHE_DIR.exists() or not any(CACHE_DIR.glob("*.npy")):
        print("[evaluate] cache not found. Run `python -m sign_to_speech.precache` first.")
        return

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    model, vocab = load_model(ckpt_path)

    if export_csv is None:
        resolved_ckpt = ckpt_path or (CHECKPOINTS_DIR / "best.pt")
        export_csv = CHECKPOINTS_DIR / "eval" / f"{resolved_ckpt.stem}_{split}_predictions.csv"

    print(f"\n[full {split.upper()} evaluation]")
    wer_score, prec, rec, f1, rows = run_full_eval(
        model, vocab, split=split, batch_size=batch_size, device=device, decode_mode=decode_mode
    )
    write_eval_csv(rows, export_csv)

    print(f"\n{'='*40}")
    print(f"  WER        : {wer_score:.4f}  ({wer_score*100:.2f}%)")
    print(f"  Precision  : {prec:.2f}%")
    print(f"  Recall     : {rec:.2f}%")
    print(f"  F1         : {f1:.2f}%")
    print(f"  Samples    : {len(rows)}")
    print(f"{'='*40}")

    if n_sample > 0:
        print_samples(rows, n=n_sample, pipeline=pipeline, seed=seed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sign-to-Speech CTC evaluation")
    parser.add_argument("--ckpt", type=Path, default=None, help="checkpoint path")
    parser.add_argument("--split", choices=["train", "val"], default="val")
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--n_sample", type=int, default=10, help="number of printed samples")
    parser.add_argument("--pipeline", action="store_true", help="run gloss-to-korean on samples")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--export_csv", type=Path, default=None, help="csv output path")
    parser.add_argument("--decode", choices=["beam", "greedy"], default="greedy")
    args = parser.parse_args()

    evaluate(
        ckpt_path=args.ckpt,
        split=args.split,
        batch_size=args.batch_size,
        n_sample=args.n_sample,
        pipeline=args.pipeline,
        seed=args.seed,
        export_csv=args.export_csv,
        decode_mode=args.decode,
    )
