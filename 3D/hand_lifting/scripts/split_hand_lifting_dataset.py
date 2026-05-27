#!/usr/bin/env python3
"""Split hand-lifting dataset shards by sequence id.

The split is sequence-level: every row for the same sequence_id goes to the
same train/val/test bucket. Assignment is deterministic by stable hash so it is
independent of shard order.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


SPLITS = ("train", "val", "test")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-shard-dir",
        required=True,
        action="append",
        type=Path,
        help="Directory containing dataset JSONL shards. Can be provided multiple times.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Output directory for split shards and manifest.",
    )
    parser.add_argument(
        "--summary-output",
        required=True,
        type=Path,
        help="Compact split summary JSON output.",
    )
    parser.add_argument(
        "--dataset-kind",
        required=True,
        choices=("word", "sen", "mixed"),
        help="Dataset kind used in output shard names.",
    )
    parser.add_argument(
        "--train-ratio",
        default=0.8,
        type=float,
        help="Train sequence ratio. Default: 0.8.",
    )
    parser.add_argument(
        "--val-ratio",
        default=0.1,
        type=float,
        help="Validation sequence ratio. Default: 0.1.",
    )
    parser.add_argument(
        "--test-ratio",
        default=0.1,
        type=float,
        help="Test sequence ratio. Default: 0.1.",
    )
    parser.add_argument(
        "--seed",
        default="hand_lifting_v1",
        help="Stable hash seed. Default: hand_lifting_v1.",
    )
    parser.add_argument(
        "--shard-size",
        default=100_000,
        type=int,
        help="Rows per output shard. Default: 100000.",
    )
    args = parser.parse_args()
    total = args.train_ratio + args.val_ratio + args.test_ratio
    if total <= 0:
        parser.error("Split ratios must sum to a positive value.")
    if args.shard_size < 1:
        parser.error("--shard-size must be >= 1.")
    return args


def iter_input_files(input_dirs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for input_dir in input_dirs:
        if not input_dir.exists():
            raise FileNotFoundError(f"Input shard dir does not exist: {input_dir}")
        files.extend(sorted(input_dir.glob("*.jsonl")))
    return sorted(files)


def split_for_sequence(sequence_id: str, seed: str, train_ratio: float, val_ratio: float, test_ratio: float) -> str:
    total = train_ratio + val_ratio + test_ratio
    train_cut = train_ratio / total
    val_cut = (train_ratio + val_ratio) / total
    digest = hashlib.sha256(f"{seed}:{sequence_id}".encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") / float(2**64)
    if value < train_cut:
        return "train"
    if value < val_cut:
        return "val"
    return "test"


class SplitShardWriter:
    def __init__(self, output_dir: Path, dataset_kind: str, shard_size: int):
        self.output_dir = output_dir
        self.dataset_kind = dataset_kind
        self.shard_size = shard_size
        self.handles: dict[str, Any] = {}
        self.shard_indices: Counter[str] = Counter()
        self.rows_in_shard: Counter[str] = Counter()
        self.files: dict[str, list[str]] = {split: [] for split in SPLITS}

    def __enter__(self):
        for split in SPLITS:
            (self.output_dir / split).mkdir(parents=True, exist_ok=True)
        return self

    def __exit__(self, exc_type, exc, tb):
        for handle in self.handles.values():
            handle.close()

    def _open_next(self, split: str):
        if split in self.handles:
            self.handles[split].close()
        shard_index = self.shard_indices[split]
        shard_path = self.output_dir / split / f"{self.dataset_kind}_{split}_{shard_index:05d}.jsonl"
        self.handles[split] = shard_path.open("w", encoding="utf-8")
        self.files[split].append(str(shard_path))
        self.shard_indices[split] += 1
        self.rows_in_shard[split] = 0

    def write_line(self, split: str, line: str):
        if split not in self.handles or self.rows_in_shard[split] >= self.shard_size:
            self._open_next(split)
        self.handles[split].write(line)
        self.rows_in_shard[split] += 1


def main() -> int:
    args = parse_args()
    input_files = iter_input_files(args.input_shard_dir)
    if not input_files:
        raise FileNotFoundError("No JSONL input shards found.")

    row_counts: Counter[str] = Counter()
    sequence_sets: dict[str, set[str]] = {split: set() for split in SPLITS}
    sequence_split: dict[str, str] = {}
    target_counts: Counter[str] = Counter()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with SplitShardWriter(args.output_dir, args.dataset_kind, args.shard_size) as writer:
        for input_file in input_files:
            with input_file.open(encoding="utf-8-sig") as fp:
                for line in fp:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    row = json.loads(stripped)
                    sequence_id = str(row["sequence_id"])
                    split = sequence_split.get(sequence_id)
                    if split is None:
                        split = split_for_sequence(
                            sequence_id,
                            args.seed,
                            args.train_ratio,
                            args.val_ratio,
                            args.test_ratio,
                        )
                        sequence_split[sequence_id] = split
                        sequence_sets[split].add(sequence_id)
                    writer.write_line(split, line)
                    row_counts[split] += 1
                    for hand in ("left", "right"):
                        mask = (row.get("masks") or {}).get(hand) or {}
                        for target in ("wrist", "palm", "finger"):
                            key = f"use_{target}_depth"
                            target_counts[f"{split}.{hand}.{target}.usable" if mask.get(key) else f"{split}.{hand}.{target}.rejected"] += 1

    def target_ratio(split: str, hand: str, target: str) -> float | None:
        usable = target_counts.get(f"{split}.{hand}.{target}.usable", 0)
        rejected = target_counts.get(f"{split}.{hand}.{target}.rejected", 0)
        total = usable + rejected
        return round(usable / total, 6) if total else None

    split_summary = {}
    for split in SPLITS:
        split_summary[split] = {
            "sequence_count": len(sequence_sets[split]),
            "row_count": row_counts.get(split, 0),
            "target_usable_ratios": {
                f"{hand}.{target}": target_ratio(split, hand, target)
                for hand in ("left", "right")
                for target in ("wrist", "palm", "finger")
            },
        }

    manifest = {
        "config": {
            "input_shard_dirs": [str(path) for path in args.input_shard_dir],
            "output_dir": str(args.output_dir),
            "dataset_kind": args.dataset_kind,
            "train_ratio": args.train_ratio,
            "val_ratio": args.val_ratio,
            "test_ratio": args.test_ratio,
            "seed": args.seed,
            "shard_size": args.shard_size,
        },
        "summary": {
            "total_sequence_count": len(sequence_split),
            "total_row_count": sum(row_counts.values()),
            "splits": split_summary,
        },
        "files": writer.files,
        "sequence_split": dict(sorted(sequence_split.items())),
    }
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Input shards: {len(input_files)}")
    print(f"Sequences: {len(sequence_split)}")
    print(f"Rows: {sum(row_counts.values())}")
    for split in SPLITS:
        print(f"{split}: sequences={len(sequence_sets[split])} rows={row_counts.get(split, 0)}")
    print(f"Summary: {args.summary_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
