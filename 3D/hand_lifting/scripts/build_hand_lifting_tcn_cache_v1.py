#!/usr/bin/env python3
"""Build shared temporal window tensor cache for hand-lifting TCN v1.

The cache is shared by center-frame and sequence prediction modes. It converts
frame-wise split JSONL rows into window tensors while preserving split and
sequence boundaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import torch

from train_hand_lifting_mlp_v0_5 import INPUT_LAYOUT, TARGET_LAYOUT, row_to_sample


DEFAULT_SPLIT_ROOT = Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting_full_F/05_split/mixed")
DEFAULT_OUTPUT_ROOT = Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting_full_F/07_tcn_cache/mixed")
SPLITS = ("train", "val", "test")
KIND_NAMES = {0: "word", 1: "sen"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-root", type=Path, default=DEFAULT_SPLIT_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--splits", default="train,val,test")
    parser.add_argument("--window-size", type=int, default=15)
    parser.add_argument("--center-index", type=int, default=7)
    parser.add_argument("--pad-mode", choices=("edge",), default="edge")
    parser.add_argument("--shard-size", type=int, default=50000)
    parser.add_argument("--max-windows-per-split", type=int)
    parser.add_argument("--workers", type=int, default=8, help="Number of split-level workers. Sequence order is preserved within each split.")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.window_size < 1:
        parser.error("--window-size must be >= 1.")
    if not 0 <= args.center_index < args.window_size:
        parser.error("--center-index must satisfy 0 <= center-index < window-size.")
    if args.shard_size < 1:
        parser.error("--shard-size must be >= 1.")
    return args


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def list_jsonl_files(split_root: Path, split: str) -> list[Path]:
    split_dir = split_root / split
    if not split_dir.exists():
        raise FileNotFoundError(f"Split directory does not exist: {split_dir}")
    files = sorted(split_dir.glob("*.jsonl"))
    if not files:
        raise FileNotFoundError(f"No JSONL shards found in: {split_dir}")
    return files


def iter_rows(files: list[Path]) -> Iterable[tuple[Path, dict[str, Any]]]:
    for path in files:
        with path.open(encoding="utf-8-sig") as fp:
            for line in fp:
                stripped = line.strip()
                if stripped:
                    yield path, json.loads(stripped)


def pad_index(index: int, length: int) -> int:
    if index < 0:
        return 0
    if index >= length:
        return length - 1
    return index


def sample_to_window(
    samples: list[dict[str, torch.Tensor]],
    positions: list[int],
    center_position: int,
    window_size: int,
    center_index: int,
) -> dict[str, torch.Tensor]:
    selected = [
        pad_index(center_position + offset - center_index, len(samples))
        for offset in range(window_size)
    ]
    return {
        "x": torch.stack([samples[index]["x"] for index in selected]).contiguous(),
        "target": torch.stack([samples[index]["target"] for index in selected]).contiguous(),
        "mask": torch.stack([samples[index]["mask"] for index in selected]).contiguous(),
        "frame_indices": torch.tensor([positions[index] for index in selected], dtype=torch.long),
    }


class TcnShardWriter:
    def __init__(self, output_dir: Path, split: str, shard_size: int):
        self.output_dir = output_dir
        self.split = split
        self.shard_size = shard_size
        self.shard_index = 0
        self.sequence_ids: list[str] = []
        self.sequence_id_to_index: dict[str, int] = {}
        self.reset_buffers()
        self.shards: list[dict[str, Any]] = []

    def reset_buffers(self) -> None:
        self.x_rows: list[torch.Tensor] = []
        self.target_rows: list[torch.Tensor] = []
        self.mask_rows: list[torch.Tensor] = []
        self.kind_rows: list[torch.Tensor] = []
        self.sequence_index_rows: list[int] = []
        self.center_frame_rows: list[int] = []
        self.frame_indices_rows: list[torch.Tensor] = []

    def sequence_index(self, sequence_id: str) -> int:
        if sequence_id not in self.sequence_id_to_index:
            self.sequence_id_to_index[sequence_id] = len(self.sequence_ids)
            self.sequence_ids.append(sequence_id)
        return self.sequence_id_to_index[sequence_id]

    def append(self, sequence_id: str, center_frame: int, window: dict[str, torch.Tensor], kind: torch.Tensor) -> None:
        self.x_rows.append(window["x"])
        self.target_rows.append(window["target"])
        self.mask_rows.append(window["mask"])
        self.kind_rows.append(kind.long())
        self.sequence_index_rows.append(self.sequence_index(sequence_id))
        self.center_frame_rows.append(int(center_frame))
        self.frame_indices_rows.append(window["frame_indices"])
        if len(self.x_rows) >= self.shard_size:
            self.flush()

    def flush(self) -> None:
        if not self.x_rows:
            return
        self.output_dir.mkdir(parents=True, exist_ok=True)
        path = self.output_dir / f"{self.split}_tcn_window_{self.shard_index:05d}.pt"
        payload = {
            "schema_version": "hand-lifting-tcn-cache/v1",
            "split": self.split,
            "x": torch.stack(self.x_rows).contiguous(),
            "target": torch.stack(self.target_rows).contiguous(),
            "mask": torch.stack(self.mask_rows).contiguous(),
            "kind": torch.stack(self.kind_rows).contiguous(),
            "sequence_index": torch.tensor(self.sequence_index_rows, dtype=torch.long),
            "center_frame_index": torch.tensor(self.center_frame_rows, dtype=torch.long),
            "frame_indices": torch.stack(self.frame_indices_rows).contiguous(),
            "sequence_ids": self.sequence_ids,
            "input_layout": INPUT_LAYOUT,
            "target_layout": TARGET_LAYOUT,
        }
        torch.save(payload, path)
        self.shards.append(
            {
                "path": str(path),
                "window_count": len(self.x_rows),
                "input_shape": list(payload["x"].shape),
                "target_shape": list(payload["target"].shape),
                "mask_true_count": int(payload["mask"].sum().item()),
            }
        )
        self.shard_index += 1
        self.reset_buffers()


def process_sequence(
    sequence_id: str,
    rows: list[dict[str, Any]],
    writer: TcnShardWriter,
    window_size: int,
    center_index: int,
    max_windows: int | None = None,
) -> dict[str, Any]:
    samples: list[dict[str, torch.Tensor]] = []
    positions: list[int] = []
    skipped_no_mask = 0
    for row in sorted(rows, key=lambda item: (int(item.get("frame_position", item.get("frame_index", 0))), int(item.get("frame_index", 0)))):
        sample = row_to_sample(row)
        if not sample["mask"].any():
            skipped_no_mask += 1
            continue
        samples.append(sample)
        positions.append(int(row.get("frame_index", row.get("frame_position", len(positions)))))

    if not samples:
        return {"sequence_id": sequence_id, "frame_count": len(rows), "window_count": 0, "skipped_no_mask": skipped_no_mask}

    written = 0
    for center_position, sample in enumerate(samples):
        if max_windows is not None and written >= max_windows:
            break
        window = sample_to_window(samples, positions, center_position, window_size, center_index)
        if window["mask"].any():
            writer.append(sequence_id, positions[center_position], window, sample["kind"])
            written += 1
    return {
        "sequence_id": sequence_id,
        "frame_count": len(rows),
        "usable_frame_count": len(samples),
        "window_count": written,
        "skipped_no_mask": skipped_no_mask,
    }


def build_split_cache(
    split_root: Path,
    output_root: Path,
    split: str,
    window_size: int,
    center_index: int,
    shard_size: int,
    max_windows: int | None,
    overwrite: bool,
) -> dict[str, Any]:
    split_output = output_root / split
    if split_output.exists() and any(split_output.glob("*.pt")) and not overwrite:
        raise FileExistsError(f"TCN cache exists for {split}: {split_output}. Use --overwrite to rebuild.")
    if split_output.exists() and overwrite:
        for path in split_output.glob("*.pt"):
            path.unlink()

    files = list_jsonl_files(split_root, split)
    writer = TcnShardWriter(split_output, split, shard_size)
    seen_sequences: set[str] = set()
    current_sequence: str | None = None
    current_rows: list[dict[str, Any]] = []
    sequence_summaries: list[dict[str, Any]] = []
    started = time.time()
    parsed_rows = 0
    emitted_windows = 0
    consumed_files: set[Path] = set()

    def flush_current() -> None:
        nonlocal current_sequence, current_rows, emitted_windows
        if current_sequence is None:
            return
        remaining = None if max_windows is None else max(0, max_windows - emitted_windows)
        summary = process_sequence(current_sequence, current_rows, writer, window_size, center_index, remaining)
        emitted_windows += int(summary["window_count"])
        sequence_summaries.append(summary)
        current_sequence = None
        current_rows = []

    for source_path, row in iter_rows(files):
        consumed_files.add(source_path)
        sequence_id = str(row.get("sequence_id") or "")
        if not sequence_id:
            raise ValueError(f"Missing sequence_id in split {split}")
        if current_sequence is None:
            if sequence_id in seen_sequences:
                raise ValueError(f"Sequence reappeared non-contiguously in {split}: {sequence_id}")
            current_sequence = sequence_id
            seen_sequences.add(sequence_id)
        elif sequence_id != current_sequence:
            flush_current()
            if max_windows is not None and emitted_windows >= max_windows:
                break
            if sequence_id in seen_sequences:
                raise ValueError(f"Sequence reappeared non-contiguously in {split}: {sequence_id}")
            current_sequence = sequence_id
            seen_sequences.add(sequence_id)
        current_rows.append(row)
        parsed_rows += 1
    if max_windows is None or emitted_windows < max_windows:
        flush_current()
    writer.flush()

    kind_counts: Counter[str] = Counter()
    mask_valid_count = 0
    for shard in writer.shards:
        payload = torch.load(shard["path"], map_location="cpu", weights_only=False)
        for value, count in Counter(payload["kind"].tolist()).items():
            kind_counts[KIND_NAMES.get(int(value), f"unknown_{value}")] += int(count)
        mask_valid_count += int(payload["mask"].sum().item())

    return {
        "split": split,
        "jsonl_files": [
            {"path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size}
            for path in sorted(consumed_files)
        ],
        "parsed_row_count": parsed_rows,
        "sequence_count": len(sequence_summaries),
        "window_count": sum(item["window_count"] for item in sequence_summaries),
        "kind_counts": dict(sorted(kind_counts.items())),
        "valid_target_count": mask_valid_count,
        "shard_count": len(writer.shards),
        "shards": writer.shards,
        "elapsed_sec": round(time.time() - started, 3),
    }


def main() -> int:
    args = parse_args()
    selected_splits = tuple(item.strip() for item in args.splits.split(",") if item.strip())
    invalid = sorted(set(selected_splits) - set(SPLITS))
    if invalid:
        raise ValueError(f"Unsupported split names: {invalid}")

    summary = {
        "schema_version": "hand-lifting-tcn-cache-summary/v1",
        "created_at": now_iso(),
        "split_root": str(args.split_root),
        "output_root": str(args.output_root),
        "config": {
            "window_size": args.window_size,
            "center_index": args.center_index,
            "pad_mode": args.pad_mode,
            "shard_size": args.shard_size,
            "max_windows_per_split": args.max_windows_per_split,
            "input_dim": INPUT_LAYOUT["input_dim"],
            "output_dim": TARGET_LAYOUT["output_dim"],
        },
        "input_layout": INPUT_LAYOUT,
        "target_layout": TARGET_LAYOUT,
        "splits": {},
    }
    worker_count = max(1, min(args.workers, len(selected_splits)))
    build_args = [
        (
            args.split_root,
            args.output_root,
            split,
            args.window_size,
            args.center_index,
            args.shard_size,
            args.max_windows_per_split,
            args.overwrite,
        )
        for split in selected_splits
    ]
    if worker_count == 1:
        for item in build_args:
            split = item[2]
            print(f"Building TCN cache split={split}", flush=True)
            split_summary = build_split_cache(*item)
            summary["splits"][split] = split_summary
            print(
                f"{split}: sequences={split_summary['sequence_count']} windows={split_summary['window_count']} shards={split_summary['shard_count']}",
                flush=True,
            )
    else:
        print(f"Building TCN cache with {worker_count} split workers", flush=True)
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(build_split_cache, *item): item[2] for item in build_args}
            for future in as_completed(futures):
                split = futures[future]
                split_summary = future.result()
                summary["splits"][split] = split_summary
                print(
                    f"{split}: sequences={split_summary['sequence_count']} windows={split_summary['window_count']} shards={split_summary['shard_count']}",
                    flush=True,
                )
        summary["splits"] = {split: summary["splits"][split] for split in selected_splits}
    write_json(args.output_root / "hand_lifting_tcn_cache_v1_summary.json", summary)
    print(f"Summary: {args.output_root / 'hand_lifting_tcn_cache_v1_summary.json'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
