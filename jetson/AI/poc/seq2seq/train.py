"""
Train the gloss <-> Korean seq2seq model on the leakage-free dataset.

Examples:
    python -m poc.seq2seq.train
    python -m poc.seq2seq.train --epochs 10 --batch-size 16
    python -m poc.seq2seq.train --max-train-samples 512 --max-val-samples 128
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

import torch
from torch.utils.data import Dataset as TorchDataset
from transformers import (
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    EarlyStoppingCallback,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
    T5ForConditionalGeneration,
)

import evaluate as hf_evaluate

from core.config import SEQ2SEQ_DATA_PATH, SEQ2SEQ_MODEL_DIR
from poc.seq2seq.data_builder import build_dataset

MODEL_NAME = "paust/pko-t5-small"
MAX_IN_LEN = 128
MAX_OUT_LEN = 128


class PairDataset(TorchDataset):
    def __init__(self, pairs: List[Dict[str, object]], tokenizer, max_in: int, max_out: int):
        self.pairs = pairs
        self.tokenizer = tokenizer
        self.max_in = max_in
        self.max_out = max_out

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, idx: int) -> Dict[str, List[int]]:
        item = self.pairs[idx]
        model_inputs = self.tokenizer(
            str(item["input"]),
            max_length=self.max_in,
            truncation=True,
            padding=False,
        )
        labels = self.tokenizer(
            text_target=str(item["target"]),
            max_length=self.max_out,
            truncation=True,
            padding=False,
        )
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs


def load_split_examples(data_path: Path = SEQ2SEQ_DATA_PATH) -> Dict[str, List[Dict[str, object]]]:
    rebuild_required = False
    if not data_path.exists():
        print("[train] dataset missing, rebuilding first")
        rebuild_required = True
    else:
        with open(data_path, encoding="utf-8") as handle:
            data = json.load(handle)
        meta = data.get("meta", {})
        if meta.get("task_gloss_mode") != "full_gloss":
            print("[train] dataset uses legacy filtered gloss mode, rebuilding for full gloss")
            rebuild_required = True
        elif meta.get("filter_to_word_db") is True:
            print("[train] dataset still filters to word_db, rebuilding without filter")
            rebuild_required = True

    if rebuild_required:
        build_dataset(filter_to_word_db=False)
        with open(data_path, encoding="utf-8") as handle:
            data = json.load(handle)

    return {
        "train": list(data.get("train", [])),
        "val": list(data.get("val", [])),
        "test": list(data.get("test", [])),
    }


def compute_metrics_fn(tokenizer, bleu_metric):
    def compute_metrics(eval_pred):
        predictions, labels = eval_pred
        if isinstance(predictions, tuple):
            predictions = predictions[0]
        predictions = torch.tensor(predictions).clamp(min=0)
        labels = [[token for token in row if token != -100] for row in labels]
        decoded_predictions = [item.strip() for item in tokenizer.batch_decode(predictions, skip_special_tokens=True)]
        decoded_labels = [item.strip() for item in tokenizer.batch_decode(labels, skip_special_tokens=True)]
        bleu = bleu_metric.compute(
            predictions=decoded_predictions,
            references=[[label] for label in decoded_labels],
        )
        exact_match = (
            sum(int(pred == label) for pred, label in zip(decoded_predictions, decoded_labels)) / max(len(decoded_predictions), 1) * 100.0
        )
        return {
            "bleu": round(float(bleu["score"]), 2),
            "exact_match": round(exact_match, 2),
        }

    return compute_metrics


def _find_last_checkpoint(output_dir: Path) -> str | None:
    if not output_dir.exists():
        return None
    checkpoints = sorted(
        [path for path in output_dir.iterdir() if path.is_dir() and path.name.startswith("checkpoint-")],
        key=lambda path: int(path.name.split("-")[-1]),
    )
    return str(checkpoints[-1]) if checkpoints else None


def train(
    epochs: int = 10,
    batch_size: int = 16,
    lr: float = 5e-5,
    warmup_steps: int = 200,
    patience: int = 5,
    resume: bool = False,
    max_train_samples: int | None = None,
    max_val_samples: int | None = None,
    data_path: Path = SEQ2SEQ_DATA_PATH,
    output_dir: Path = SEQ2SEQ_MODEL_DIR,
) -> None:
    splits = load_split_examples(data_path=data_path)
    train_pairs = splits["train"][:max_train_samples] if max_train_samples else splits["train"]
    val_pairs = splits["val"][:max_val_samples] if max_val_samples else splits["val"]

    print(f"[train] train={len(train_pairs)} val={len(val_pairs)} test={len(splits['test'])}")

    output_dir.mkdir(parents=True, exist_ok=True)
    resume_from = _find_last_checkpoint(output_dir) if resume else None
    load_from = resume_from or MODEL_NAME
    print(f"[train] model load: {load_from}")

    tokenizer = AutoTokenizer.from_pretrained(load_from)
    model = T5ForConditionalGeneration.from_pretrained(load_from)

    train_dataset = PairDataset(train_pairs, tokenizer, MAX_IN_LEN, MAX_OUT_LEN)
    val_dataset = PairDataset(val_pairs, tokenizer, MAX_IN_LEN, MAX_OUT_LEN)
    collator = DataCollatorForSeq2Seq(tokenizer, model=model, padding=True, label_pad_token_id=-100)
    bleu_metric = hf_evaluate.load("sacrebleu")

    args = Seq2SeqTrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=lr,
        warmup_steps=warmup_steps,
        weight_decay=0.01,
        predict_with_generate=True,
        generation_max_length=MAX_OUT_LEN,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="bleu",
        greater_is_better=True,
        save_total_limit=2,
        fp16=torch.cuda.is_available(),
        logging_steps=50,
        report_to="none",
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        tokenizer=tokenizer,
        data_collator=collator,
        compute_metrics=compute_metrics_fn(tokenizer, bleu_metric),
        callbacks=[EarlyStoppingCallback(early_stopping_patience=patience)],
    )

    print("[train] start")
    trainer.train(resume_from_checkpoint=resume_from)

    best_dir = output_dir / "best"
    trainer.save_model(str(best_dir))
    tokenizer.save_pretrained(str(best_dir))
    print(f"[train] saved best model: {best_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--warmup-steps", type=int, default=200)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--max-train-samples", type=int, default=None)
    parser.add_argument("--max-val-samples", type=int, default=None)
    parser.add_argument("--data-path", type=Path, default=SEQ2SEQ_DATA_PATH)
    parser.add_argument("--output-dir", type=Path, default=SEQ2SEQ_MODEL_DIR)
    args = parser.parse_args()
    train(
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        warmup_steps=args.warmup_steps,
        patience=args.patience,
        resume=args.resume,
        max_train_samples=args.max_train_samples,
        max_val_samples=args.max_val_samples,
        data_path=args.data_path,
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    main()
