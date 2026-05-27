#!/usr/bin/env python3
"""Build tensor cache shards for v0.5 hand lifting MLP training.

The JSONL dataset remains the inspectable intermediate artifact. This script
converts each split shard into tensors so training can avoid per-row JSON
parsing, flattening, and tensor construction.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

from train_hand_lifting_mlp_v0_5 import (
    GROUP_INDICES,
    HAND_ORDER,
    INPUT_LAYOUT,
    TARGET_LAYOUT,
    DEFAULT_SPLIT_ROOT,
    DEFAULT_TENSOR_CACHE_ROOT,
    row_to_sample,
)


KIND_NAMES = {0: "word", 1: "sen"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-root", type=Path, default=DEFAULT_SPLIT_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_TENSOR_CACHE_ROOT)
    parser.add_argument("--splits", default="train,val,test", help="Comma-separated split names.")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--max-rows-per-shard", type=int)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def list_jsonl_files(split_root: Path, split: str) -> list[Path]:
    split_dir = split_root / split
    if not split_dir.exists():
        raise FileNotFoundError(f"Split directory does not exist: {split_dir}")
    files = sorted(split_dir.glob("*.jsonl"))
    if not files:
        raise FileNotFoundError(f"No JSONL shards found in: {split_dir}")
    return files


def summarize_tensors(mask: torch.Tensor, kind: torch.Tensor) -> dict[str, Any]:
    row_count = int(mask.shape[0])
    valid_counts: dict[str, int] = {}
    valid_ratios: dict[str, float | None] = {}
    for hand_index, hand in enumerate(HAND_ORDER):
        for group, indices in GROUP_INDICES.items():
            side_indices = [
                index
                for index in indices
                if TARGET_LAYOUT["target_specs"][index]["side"] == hand
            ]
            count = int(mask[:, side_indices].sum().item()) if side_indices else 0
            denominator = row_count * len(side_indices)
            key = f"{hand}.{group}"
            valid_counts[key] = count
            valid_ratios[key] = round(count / denominator, 6) if denominator else None

    kind_counts: Counter[str] = Counter()
    for value, count in Counter(kind.tolist()).items():
        kind_counts[KIND_NAMES.get(int(value), f"unknown_{value}")] += int(count)

    return {
        "row_count": row_count,
        "input_dim": INPUT_LAYOUT["input_dim"],
        "output_dim": TARGET_LAYOUT["output_dim"],
        "kind_counts": dict(sorted(kind_counts.items())),
        "valid_target_count": int(mask.sum().item()),
        "mask_valid_count": valid_counts,
        "mask_valid_ratio": valid_ratios,
    }


def summarize_existing(path: Path, source_path: Path, split: str) -> dict[str, Any]:
    payload = torch.load(path, map_location="cpu", weights_only=False)
    summary = summarize_tensors(payload["mask"].bool(), payload["kind"].long())
    summary.update(
        {
            "split": split,
            "jsonl_path": str(source_path),
            "tensor_path": str(path),
            "jsonl_sha256": sha256_file(source_path),
            "status": "reused",
        }
    )
    return summary


def convert_shard(task: tuple[str, Path, Path, int | None, bool]) -> dict[str, Any]:
    split, source_path, output_path, max_rows, overwrite = task
    torch.set_num_threads(1)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and not overwrite:
        return summarize_existing(output_path, source_path, split)

    started = time.time()
    x_rows: list[torch.Tensor] = []
    target_rows: list[torch.Tensor] = []
    mask_rows: list[torch.Tensor] = []
    kind_rows: list[torch.Tensor] = []
    skipped_no_mask = 0
    parsed_rows = 0

    with source_path.open(encoding="utf-8-sig") as fp:
        for line in fp:
            stripped = line.strip()
            if not stripped:
                continue
            row = json.loads(stripped)
            sample = row_to_sample(row)
            parsed_rows += 1
            if not sample["mask"].any():
                skipped_no_mask += 1
                continue
            x_rows.append(sample["x"])
            target_rows.append(sample["target"])
            mask_rows.append(sample["mask"])
            kind_rows.append(sample["kind"])
            if max_rows is not None and len(x_rows) >= max_rows:
                break

    if x_rows:
        x = torch.stack(x_rows).contiguous()
        target = torch.stack(target_rows).contiguous()
        mask = torch.stack(mask_rows).contiguous()
        kind = torch.stack(kind_rows).contiguous()
    else:
        x = torch.empty((0, INPUT_LAYOUT["input_dim"]), dtype=torch.float32)
        target = torch.empty((0, TARGET_LAYOUT["output_dim"]), dtype=torch.float32)
        mask = torch.empty((0, TARGET_LAYOUT["output_dim"]), dtype=torch.bool)
        kind = torch.empty((0,), dtype=torch.long)

    payload = {
        "x": x,
        "target": target,
        "mask": mask,
        "kind": kind,
        "source": {
            "jsonl_path": str(source_path),
            "jsonl_sha256": sha256_file(source_path),
            "parsed_row_count": parsed_rows,
            "skipped_no_mask_count": skipped_no_mask,
            "cached_row_count": int(x.shape[0]),
        },
        "input_layout": INPUT_LAYOUT,
        "target_layout": TARGET_LAYOUT,
    }
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    torch.save(payload, tmp_path)
    tmp_path.replace(output_path)

    summary = summarize_tensors(mask, kind)
    summary.update(
        {
            "split": split,
            "jsonl_path": str(source_path),
            "tensor_path": str(output_path),
            "jsonl_sha256": payload["source"]["jsonl_sha256"],
            "parsed_row_count": parsed_rows,
            "skipped_no_mask_count": skipped_no_mask,
            "elapsed_sec": round(time.time() - started, 3),
            "status": "built",
        }
    )
    return summary


def merge_split_summaries(items: list[dict[str, Any]]) -> dict[str, Any]:
    row_count = sum(int(item["row_count"]) for item in items)
    parsed_row_count = sum(int(item.get("parsed_row_count", item["row_count"])) for item in items)
    skipped_no_mask_count = sum(int(item.get("skipped_no_mask_count", 0)) for item in items)
    kind_counts: Counter[str] = Counter()
    valid_counts: defaultdict[str, int] = defaultdict(int)

    for item in items:
        kind_counts.update(item.get("kind_counts", {}))
        for key, value in item["mask_valid_count"].items():
            valid_counts[key] += int(value)

    valid_ratios: dict[str, float | None] = {}
    for hand in HAND_ORDER:
        for group, indices in GROUP_INDICES.items():
            key = f"{hand}.{group}"
            side_indices = [
                index
                for index in indices
                if TARGET_LAYOUT["target_specs"][index]["side"] == hand
            ]
            denominator = row_count * len(side_indices)
            valid_ratios[key] = round(valid_counts[key] / denominator, 6) if denominator else None

    return {
        "shard_count": len(items),
        "row_count": row_count,
        "parsed_row_count": parsed_row_count,
        "skipped_no_mask_count": skipped_no_mask_count,
        "kind_counts": dict(sorted(kind_counts.items())),
        "mask_valid_count": dict(sorted(valid_counts.items())),
        "mask_valid_ratio": valid_ratios,
    }


def main() -> int:
    args = parse_args()
    splits = [item.strip() for item in args.splits.split(",") if item.strip()]
    worker_count = max(1, min(args.workers, 61 if os.name == "nt" else args.workers))

    tasks: list[tuple[str, Path, Path, int | None, bool]] = []
    for split in splits:
        for source_path in list_jsonl_files(args.split_root, split):
            output_path = args.output_root / split / source_path.with_suffix(".pt").name
            tasks.append((split, source_path, output_path, args.max_rows_per_shard, args.overwrite))

    summaries: list[dict[str, Any]] = []
    if worker_count == 1:
        for task in tasks:
            summary = convert_shard(task)
            summaries.append(summary)
            print(
                f"{summary['status']} split={summary['split']} rows={summary['row_count']} "
                f"{Path(summary['tensor_path']).name}",
                flush=True,
            )
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=worker_count) as executor:
            future_to_task = {executor.submit(convert_shard, task): task for task in tasks}
            for future in concurrent.futures.as_completed(future_to_task):
                summary = future.result()
                summaries.append(summary)
                print(
                    f"{summary['status']} split={summary['split']} rows={summary['row_count']} "
                    f"{Path(summary['tensor_path']).name}",
                    flush=True,
                )

    summaries.sort(key=lambda item: (item["split"], item["tensor_path"]))
    by_split = {
        split: merge_split_summaries([item for item in summaries if item["split"] == split])
        for split in splits
    }
    summary_payload = {
        "schema_version": "hand-lifting-tensor-cache/v1",
        "created_at": now_iso(),
        "split_root": str(args.split_root),
        "output_root": str(args.output_root),
        "workers": worker_count,
        "max_rows_per_shard": args.max_rows_per_shard,
        "input_dim": INPUT_LAYOUT["input_dim"],
        "output_dim": TARGET_LAYOUT["output_dim"],
        "splits": by_split,
        "shards": summaries,
    }
    summary_path = args.output_root / "hand_lifting_tensor_cache_mixed_summary.json"
    write_json(summary_path, summary_payload)
    print(f"Summary: {summary_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
