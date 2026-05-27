"""
Evaluate the seq2seq translator on validation or test splits.

Examples:
    python -m poc.seq2seq.evaluate --split val
    python -m poc.seq2seq.evaluate --split test
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path
from typing import Dict, List, Tuple

from core.config import SEQ2SEQ_DATA_PATH, SEQ2SEQ_MODEL_DIR, get_active_word_db_path


def load_examples(
    data_path: Path,
    split: str,
    limit: int | None = None,
) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]]]:
    with open(data_path, encoding="utf-8") as handle:
        data = json.load(handle)
    rows = list(data.get(split, []))
    if limit is not None:
        rows = rows[: limit * 2]
    g2k = [(row["input"].split(": ", 1)[1], row["target"]) for row in rows if row["task"] == "g2k"]
    k2g = [(row["input"].split(": ", 1)[1], row["target"]) for row in rows if row["task"] == "k2g"]
    if limit is not None:
        g2k = g2k[:limit]
        k2g = k2g[:limit]
    return g2k, k2g


def load_word_db_glosses() -> set[str]:
    word_db_path = get_active_word_db_path()
    if not word_db_path.exists():
        return set()
    with open(word_db_path, encoding="utf-8") as handle:
        return set(json.load(handle).keys())


def bleu_score(preds: List[str], refs: List[str]) -> float:
    import evaluate as hf_evaluate

    metric = hf_evaluate.load("sacrebleu")
    result = metric.compute(predictions=preds, references=[[ref] for ref in refs])
    return round(float(result["score"]), 2)


def rouge_l(preds: List[str], refs: List[str]) -> float:
    import evaluate as hf_evaluate

    metric = hf_evaluate.load("rouge")
    result = metric.compute(predictions=preds, references=refs, use_stemmer=False)
    return round(float(result["rougeL"]) * 100, 2)


def gloss_f1(preds: List[str], refs: List[str]) -> Tuple[float, float, float]:
    precision_total = recall_total = f1_total = 0.0
    for pred, ref in zip(preds, refs):
        pred_tokens = set(pred.strip().split())
        ref_tokens = set(ref.strip().split())
        if not pred_tokens and not ref_tokens:
            precision_total += 1.0
            recall_total += 1.0
            f1_total += 1.0
            continue
        tp = len(pred_tokens & ref_tokens)
        precision = tp / len(pred_tokens) if pred_tokens else 0.0
        recall = tp / len(ref_tokens) if ref_tokens else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        precision_total += precision
        recall_total += recall
        f1_total += f1
    count = max(len(preds), 1)
    return (
        round(precision_total / count * 100, 2),
        round(recall_total / count * 100, 2),
        round(f1_total / count * 100, 2),
    )


def vocab_coverage(preds: List[str], word_db_glosses: set[str]) -> float:
    if not word_db_glosses:
        return -1.0
    total = covered = 0
    for pred in preds:
        for token in pred.strip().split():
            total += 1
            if token in word_db_glosses:
                covered += 1
    return round((covered / total * 100), 2) if total else 0.0


def exact_match_rate(preds: List[str], refs: List[str]) -> float:
    matches = sum(int(pred.strip() == ref.strip()) for pred, ref in zip(preds, refs))
    return round(matches / max(len(preds), 1) * 100, 2)


def token_f1(pred: str, ref: str) -> float:
    pred_tokens = set(pred.strip().split())
    ref_tokens = set(ref.strip().split())
    if not pred_tokens and not ref_tokens:
        return 100.0
    tp = len(pred_tokens & ref_tokens)
    precision = tp / len(pred_tokens) if pred_tokens else 0.0
    recall = tp / len(ref_tokens) if ref_tokens else 0.0
    if precision + recall == 0:
        return 0.0
    return round((2 * precision * recall / (precision + recall)) * 100, 4)


def speed_test(predictor_fn, inputs: List[str], n: int = 50) -> float:
    sample = inputs[:n]
    if not sample:
        return 0.0
    started = time.perf_counter()
    for text in sample:
        predictor_fn(text)
    return round(((time.perf_counter() - started) / len(sample)) * 1000, 1)


def build_rows(task: str, pairs: List[Tuple[str, str]], preds: List[str]) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for index, ((input_text, target_text), pred_text) in enumerate(zip(pairs, preds), start=1):
        rows.append(
            {
                "sample_id": f"{task}_{index:05d}",
                "task": task,
                "input_text": input_text,
                "target_text": target_text,
                "pred_text": pred_text,
                "exact_match": int(pred_text.strip() == target_text.strip()),
                "token_f1": token_f1(pred_text, target_text),
            }
        )
    return rows


def write_csv(rows: List[Dict[str, object]], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["sample_id", "task", "input_text", "target_text", "pred_text", "exact_match", "token_f1"],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"[evaluate] csv saved: {csv_path}")


def print_samples(task: str, rows: List[Dict[str, object]], limit: int = 5) -> None:
    print(f"\n[samples: {task}]")
    for row in rows[:limit]:
        print(f"  id:    {row['sample_id']}")
        print(f"  input: {row['input_text']}")
        print(f"  gold:  {row['target_text']}")
        print(f"  pred:  {row['pred_text']}")
        print(f"  exact_match={row['exact_match']} token_f1={row['token_f1']}")
        print()


def evaluate(
    split: str = "val",
    export_dir: Path | None = None,
    data_path: Path = SEQ2SEQ_DATA_PATH,
    model_dir: Path | None = None,
    limit: int | None = None,
) -> None:
    from poc.seq2seq.infer import GlossTranslator

    print("[evaluate] loading seq2seq model")
    translator = GlossTranslator(model_dir=model_dir)
    g2k_pairs, k2g_pairs = load_examples(data_path, split, limit=limit)
    export_dir = export_dir or (SEQ2SEQ_MODEL_DIR / "eval")
    word_db_glosses = load_word_db_glosses()

    print(f"[evaluate] split={split} g2k={len(g2k_pairs)} k2g={len(k2g_pairs)}")

    g2k_inputs = [item[0] for item in g2k_pairs]
    g2k_refs = [item[1] for item in g2k_pairs]
    g2k_preds = [translator.gloss_to_korean(text) for text in g2k_inputs]
    g2k_rows = build_rows("g2k", g2k_pairs, g2k_preds)
    write_csv(g2k_rows, export_dir / f"{split}_g2k_predictions.csv")

    print("\n[g2k]")
    print("  BLEU:", bleu_score(g2k_preds, g2k_refs))
    print("  ROUGE-L:", rouge_l(g2k_preds, g2k_refs))
    print("  Exact Match:", exact_match_rate(g2k_preds, g2k_refs))
    print("  Speed:", speed_test(translator.gloss_to_korean, g2k_inputs), "ms/sample")
    print_samples("g2k", g2k_rows)

    k2g_inputs = [item[0] for item in k2g_pairs]
    k2g_refs = [item[1] for item in k2g_pairs]
    k2g_preds = [translator.korean_to_gloss_str(text) for text in k2g_inputs]
    k2g_rows = build_rows("k2g", k2g_pairs, k2g_preds)
    write_csv(k2g_rows, export_dir / f"{split}_k2g_predictions.csv")

    precision, recall, f1 = gloss_f1(k2g_preds, k2g_refs)
    print("\n[k2g]")
    print("  Precision:", precision)
    print("  Recall:", recall)
    print("  F1:", f1)
    print("  Exact Match:", exact_match_rate(k2g_preds, k2g_refs))
    print("  Vocab Coverage:", vocab_coverage(k2g_preds, word_db_glosses))
    print("  Speed:", speed_test(translator.korean_to_gloss_str, k2g_inputs), "ms/sample")
    print_samples("k2g", k2g_rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["val", "test"], default="val")
    parser.add_argument("--export-dir", type=Path, default=None)
    parser.add_argument("--data-path", type=Path, default=SEQ2SEQ_DATA_PATH)
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    evaluate(
        split=args.split,
        export_dir=args.export_dir,
        data_path=args.data_path,
        model_dir=args.model_dir,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
