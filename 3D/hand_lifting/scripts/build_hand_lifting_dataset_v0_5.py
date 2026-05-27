#!/usr/bin/env python3
"""Build v0.5 hand-lifting training rows from AIHub keypoints and quality masks.

Inputs:
  - AIHub keypoint sequence folders.
  - Frame-level quality masks from build_hand_lifting_quality_mask.py.

Outputs:
  - JSONL dataset rows and/or JSONL shard files.
  - Compact summary JSON.

The v0.5 dataset keeps the same 171-dim input as v0, but adds shoulder z labels
so the trainer can produce a 46-dim arm+hand target.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import subprocess
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from pathlib import Path
from typing import Any


FRAME_RE = re.compile(r"_(\d+)_keypoints\.json$", re.IGNORECASE)

POSE_NOSE = 0
POSE_NECK = 1
POSE_RIGHT_SHOULDER = 2
POSE_RIGHT_ELBOW = 3
POSE_RIGHT_WRIST = 4
POSE_LEFT_SHOULDER = 5
POSE_LEFT_ELBOW = 6
POSE_LEFT_WRIST = 7
POSE_MID_HIP = 8
POSE_FACE_SAFE = (15, 16, 17)
POSE_INPUT_INDICES = (0, 1, 2, 3, 4, 5, 6, 7, 15, 16, 17)
HAND_PALM_INDICES = (0, 5, 9, 13, 17)
HAND_JOINT_COUNT = 21
EPSILON = 1e-6


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keypoint-root",
        action="append",
        type=Path,
        help="Directory containing *_F sequence folders. Can be provided multiple times.",
    )
    parser.add_argument(
        "--quality-mask",
        type=Path,
        help="Frame-level quality mask JSONL.",
    )
    parser.add_argument(
        "--output-jsonl",
        type=Path,
        help="Optional single JSONL output path.",
    )
    parser.add_argument(
        "--shard-dir",
        type=Path,
        help="Optional directory for sharded JSONL outputs.",
    )
    parser.add_argument(
        "--summary-output",
        type=Path,
        help="Compact dataset summary JSON output.",
    )
    parser.add_argument(
        "--dataset-kind",
        choices=("word", "sen"),
        help="Dataset kind stored in each row.",
    )
    parser.add_argument(
        "--input-roots",
        nargs="+",
        type=Path,
        help="Convenience mode: word/sen keypoint roots. Numeric children such as 01..04 are expanded.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Convenience mode output directory. Writes word/sen shard subdirectories and summaries.",
    )
    parser.add_argument(
        "--quality-mask-root",
        type=Path,
        default=Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting/03_quality_mask"),
        help="Convenience mode quality mask root.",
    )
    parser.add_argument(
        "--sequence-glob",
        default="*_F",
        help="Sequence folder glob. Default: *_F.",
    )
    parser.add_argument(
        "--shard-size",
        default=100_000,
        type=int,
        help="Rows per shard when --shard-dir is used. Default: 100000.",
    )
    parser.add_argument(
        "--workers",
        default=1,
        type=int,
        help=(
            "Number of worker processes for sequence-level parallelism. "
            "Use 1 for serial execution, or 0 for all logical CPUs. Default: 1."
        ),
    )
    args = parser.parse_args()
    if args.input_roots or args.output_dir:
        if not args.input_roots or not args.output_dir:
            parser.error("Convenience mode requires both --input-roots and --output-dir.")
    else:
        if not args.keypoint_root:
            parser.error("Provide --keypoint-root or use --input-roots convenience mode.")
        if not args.quality_mask:
            parser.error("Provide --quality-mask or use --input-roots convenience mode.")
        if not args.summary_output:
            parser.error("Provide --summary-output or use --input-roots convenience mode.")
        if not args.dataset_kind:
            parser.error("Provide --dataset-kind or use --input-roots convenience mode.")
        if not args.output_jsonl and not args.shard_dir:
            parser.error("Provide --output-jsonl, --shard-dir, or both.")
    if args.shard_size < 1:
        parser.error("--shard-size must be >= 1.")
    return args


def frame_index_from_path(path: Path) -> int:
    match = FRAME_RE.search(path.name)
    return int(match.group(1)) if match else -1


def iter_frame_files(sequence_dir: Path) -> list[Path]:
    return sorted(
        sequence_dir.glob("*_keypoints.json"),
        key=lambda path: (frame_index_from_path(path), path.name),
    )


def iter_sequence_dirs(keypoint_root: Path, sequence_glob: str) -> list[Path]:
    if not keypoint_root.exists():
        raise FileNotFoundError(f"Keypoint root does not exist: {keypoint_root}")
    return sorted(path for path in keypoint_root.glob(sequence_glob) if path.is_dir())


def build_sequence_index(keypoint_roots: list[Path], sequence_glob: str) -> dict[str, str]:
    sequence_index: dict[str, str] = {}
    duplicates: list[str] = []
    for keypoint_root in keypoint_roots:
        for sequence_dir in iter_sequence_dirs(keypoint_root, sequence_glob):
            if sequence_dir.name in sequence_index:
                duplicates.append(sequence_dir.name)
                continue
            sequence_index[sequence_dir.name] = str(sequence_dir)
    if duplicates:
        preview = ", ".join(duplicates[:10])
        raise ValueError(f"Duplicate sequence ids across keypoint roots: {preview}")
    return sequence_index


def resolve_worker_count(requested: int, item_count: int) -> int:
    worker_count = requested
    if worker_count == 0:
        worker_count = os.cpu_count() or 1
    worker_count = max(1, worker_count)
    if sys.platform == "win32":
        worker_count = min(worker_count, 61)
    cpu_count = os.cpu_count()
    if cpu_count:
        worker_count = min(worker_count, cpu_count)
    return min(worker_count, max(item_count, 1))


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def parse_point_2d(flat: list[Any], index: int) -> tuple[float, float, float] | None:
    offset = index * 3
    if offset + 2 >= len(flat):
        return None
    try:
        x = float(flat[offset])
        y = float(flat[offset + 1])
        confidence = float(flat[offset + 2])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (x, y, confidence)):
        return None
    return x, y, confidence


def parse_point_3d(flat: list[Any], index: int) -> tuple[float, float, float, float] | None:
    offset = index * 4
    if offset + 3 >= len(flat):
        return None
    try:
        x = float(flat[offset])
        y = float(flat[offset + 1])
        z = float(flat[offset + 2])
        confidence = float(flat[offset + 3])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (x, y, z, confidence)):
        return None
    return x, y, z, confidence


def valid_2d(point: tuple[float, float, float] | None) -> bool:
    return point is not None and point[2] > 0


def valid_3d(point: tuple[float, float, float, float] | None) -> bool:
    return point is not None and point[3] > 0


def distance_2d(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def distance_3d(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def normalize_point_2d(
    point: tuple[float, float, float] | None, center_x: float, center_y: float, scale: float
) -> list[float]:
    if not valid_2d(point):
        return [0.0, 0.0, 0.0]
    assert point is not None
    return [
        round((point[0] - center_x) / scale, 6),
        round((point[1] - center_y) / scale, 6),
        round(point[2], 6),
    ]


def normalize_points_2d(
    flat: list[Any], indices: tuple[int, ...], center_x: float, center_y: float, scale: float
) -> list[list[float]]:
    return [normalize_point_2d(parse_point_2d(flat, index), center_x, center_y, scale) for index in indices]


def normalize_hand_2d(flat: list[Any], center_x: float, center_y: float, scale: float) -> list[list[float]]:
    return normalize_points_2d(flat, tuple(range(HAND_JOINT_COUNT)), center_x, center_y, scale)


def mean_2d(points: list[tuple[float, float, float]]) -> tuple[float, float, float] | None:
    valid_points = [point for point in points if valid_2d(point)]
    if not valid_points:
        return None
    return (
        sum(point[0] for point in valid_points) / len(valid_points),
        sum(point[1] for point in valid_points) / len(valid_points),
        sum(point[2] for point in valid_points) / len(valid_points),
    )


def hand_palm_center_2d(flat: list[Any]) -> tuple[float, float, float] | None:
    points = [parse_point_2d(flat, index) for index in HAND_PALM_INDICES]
    return mean_2d([point for point in points if point is not None])


def hand_size_2d(flat: list[Any], scale: float) -> float:
    points = [parse_point_2d(flat, index) for index in range(HAND_JOINT_COUNT)]
    valid_points = [point for point in points if valid_2d(point)]
    if not valid_points:
        return 0.0
    xs = [point[0] for point in valid_points]
    ys = [point[1] for point in valid_points]
    return round(max(max(xs) - min(xs), max(ys) - min(ys)) / scale, 6)


def arm_extension_2d(
    pose_2d: list[Any], shoulder_index: int, wrist_index: int, shoulder_width_2d: float
) -> float:
    shoulder = parse_point_2d(pose_2d, shoulder_index)
    wrist = parse_point_2d(pose_2d, wrist_index)
    if not valid_2d(shoulder) or not valid_2d(wrist):
        return 0.0
    assert shoulder is not None and wrist is not None
    return round(distance_2d(shoulder, wrist) / shoulder_width_2d, 6)


def torso_bbox_2d(pose_2d: list[Any]) -> tuple[float, float, float, float] | None:
    points = [
        parse_point_2d(pose_2d, POSE_NECK),
        parse_point_2d(pose_2d, POSE_RIGHT_SHOULDER),
        parse_point_2d(pose_2d, POSE_LEFT_SHOULDER),
        parse_point_2d(pose_2d, POSE_MID_HIP),
    ]
    valid_points = [point for point in points if valid_2d(point)]
    if len(valid_points) < 3:
        return None
    xs = [point[0] for point in valid_points]
    ys = [point[1] for point in valid_points]
    return min(xs), min(ys), max(xs), max(ys)


def torso_overlap_score(hand_2d: list[Any], bbox: tuple[float, float, float, float] | None) -> float:
    if bbox is None:
        return 0.0
    x_min, y_min, x_max, y_max = bbox
    valid_count = 0
    inside_count = 0
    for index in range(HAND_JOINT_COUNT):
        point = parse_point_2d(hand_2d, index)
        if not valid_2d(point):
            continue
        assert point is not None
        valid_count += 1
        if x_min <= point[0] <= x_max and y_min <= point[1] <= y_max:
            inside_count += 1
    return round(inside_count / valid_count, 6) if valid_count else 0.0


def root_normalization(payload: dict[str, Any]) -> dict[str, float] | None:
    people = payload.get("people") or {}
    pose_2d = people.get("pose_keypoints_2d") or []
    pose_3d = people.get("pose_keypoints_3d") or []
    left_2d = parse_point_2d(pose_2d, POSE_LEFT_SHOULDER)
    right_2d = parse_point_2d(pose_2d, POSE_RIGHT_SHOULDER)
    left_3d = parse_point_3d(pose_3d, POSE_LEFT_SHOULDER)
    right_3d = parse_point_3d(pose_3d, POSE_RIGHT_SHOULDER)
    if not valid_2d(left_2d) or not valid_2d(right_2d) or not valid_3d(left_3d) or not valid_3d(right_3d):
        return None
    assert left_2d is not None and right_2d is not None and left_3d is not None and right_3d is not None
    shoulder_width_2d = distance_2d(left_2d, right_2d)
    shoulder_width_3d = distance_3d(left_3d, right_3d)
    if shoulder_width_2d <= EPSILON or shoulder_width_3d <= EPSILON:
        return None
    return {
        "shoulder_center_x_2d": (left_2d[0] + right_2d[0]) * 0.5,
        "shoulder_center_y_2d": (left_2d[1] + right_2d[1]) * 0.5,
        "shoulder_width_2d": shoulder_width_2d,
        "shoulder_center_z_3d": (left_3d[2] + right_3d[2]) * 0.5,
        "shoulder_width_3d": shoulder_width_3d,
    }


def z_root_relative(
    point: tuple[float, float, float, float] | None, shoulder_center_z: float, shoulder_width_3d: float
) -> float | None:
    if not valid_3d(point):
        return None
    assert point is not None
    return round((point[2] - shoulder_center_z) / shoulder_width_3d, 6)


def z_wrist_relative(
    point: tuple[float, float, float, float] | None,
    wrist: tuple[float, float, float, float] | None,
    shoulder_width_3d: float,
) -> float | None:
    if not valid_3d(point) or not valid_3d(wrist):
        return None
    assert point is not None and wrist is not None
    return round((point[2] - wrist[2]) / shoulder_width_3d, 6)


def hand_z_offsets(hand_3d: list[Any], shoulder_width_3d: float) -> list[float | None]:
    wrist = parse_point_3d(hand_3d, 0)
    return [z_wrist_relative(parse_point_3d(hand_3d, index), wrist, shoulder_width_3d) for index in range(HAND_JOINT_COUNT)]


def build_dataset_row(
    sequence_id: str, frame_file: Path, mask_row: dict[str, Any], dataset_kind: str
) -> tuple[dict[str, Any] | None, str | None]:
    payload = load_json(frame_file)
    if payload is None:
        return None, "frame_json_load_failed"
    people = payload.get("people") or {}
    pose_2d = people.get("pose_keypoints_2d") or []
    left_hand_2d = people.get("hand_left_keypoints_2d") or []
    right_hand_2d = people.get("hand_right_keypoints_2d") or []
    pose_3d = people.get("pose_keypoints_3d") or []
    left_hand_3d = people.get("hand_left_keypoints_3d") or []
    right_hand_3d = people.get("hand_right_keypoints_3d") or []

    norm = root_normalization(payload)
    if norm is None:
        return None, "invalid_root_normalization"
    center_x = norm["shoulder_center_x_2d"]
    center_y = norm["shoulder_center_y_2d"]
    shoulder_width_2d = norm["shoulder_width_2d"]
    shoulder_center_z = norm["shoulder_center_z_3d"]
    shoulder_width_3d = norm["shoulder_width_3d"]

    left_palm = hand_palm_center_2d(left_hand_2d)
    right_palm = hand_palm_center_2d(right_hand_2d)
    torso_bbox = torso_bbox_2d(pose_2d)

    labels = {
        "pose_root_z": {
            "left_shoulder": z_root_relative(parse_point_3d(pose_3d, POSE_LEFT_SHOULDER), shoulder_center_z, shoulder_width_3d),
            "left_elbow": z_root_relative(parse_point_3d(pose_3d, POSE_LEFT_ELBOW), shoulder_center_z, shoulder_width_3d),
            "left_wrist": z_root_relative(parse_point_3d(pose_3d, POSE_LEFT_WRIST), shoulder_center_z, shoulder_width_3d),
            "right_shoulder": z_root_relative(parse_point_3d(pose_3d, POSE_RIGHT_SHOULDER), shoulder_center_z, shoulder_width_3d),
            "right_elbow": z_root_relative(parse_point_3d(pose_3d, POSE_RIGHT_ELBOW), shoulder_center_z, shoulder_width_3d),
            "right_wrist": z_root_relative(parse_point_3d(pose_3d, POSE_RIGHT_WRIST), shoulder_center_z, shoulder_width_3d),
        },
        "hand_wrist_root_z": {
            "left": z_root_relative(parse_point_3d(left_hand_3d, 0), shoulder_center_z, shoulder_width_3d),
            "right": z_root_relative(parse_point_3d(right_hand_3d, 0), shoulder_center_z, shoulder_width_3d),
        },
        "hand_wrist_relative_z": {
            "left": hand_z_offsets(left_hand_3d, shoulder_width_3d),
            "right": hand_z_offsets(right_hand_3d, shoulder_width_3d),
        },
    }

    row = {
        "schema_version": 1,
        "dataset_kind": dataset_kind,
        "sequence_id": sequence_id,
        "frame_index": int(mask_row["frame_index"]),
        "frame_position": int(mask_row["frame_position"]),
        "inputs": {
            "pose_indices": list(POSE_INPUT_INDICES),
            "pose_2d_norm": normalize_points_2d(
                pose_2d, POSE_INPUT_INDICES, center_x, center_y, shoulder_width_2d
            ),
            "left_hand_2d_norm": normalize_hand_2d(left_hand_2d, center_x, center_y, shoulder_width_2d),
            "right_hand_2d_norm": normalize_hand_2d(right_hand_2d, center_x, center_y, shoulder_width_2d),
            "derived": {
                "left_palm_center_2d_norm": normalize_point_2d(left_palm, center_x, center_y, shoulder_width_2d),
                "right_palm_center_2d_norm": normalize_point_2d(right_palm, center_x, center_y, shoulder_width_2d),
                "left_hand_size_2d": hand_size_2d(left_hand_2d, shoulder_width_2d),
                "right_hand_size_2d": hand_size_2d(right_hand_2d, shoulder_width_2d),
                "left_arm_extension_2d": arm_extension_2d(
                    pose_2d, POSE_LEFT_SHOULDER, POSE_LEFT_WRIST, shoulder_width_2d
                ),
                "right_arm_extension_2d": arm_extension_2d(
                    pose_2d, POSE_RIGHT_SHOULDER, POSE_RIGHT_WRIST, shoulder_width_2d
                ),
                "left_torso_overlap_score": torso_overlap_score(left_hand_2d, torso_bbox),
                "right_torso_overlap_score": torso_overlap_score(right_hand_2d, torso_bbox),
            },
        },
        "labels": labels,
        "masks": mask_row["hands"],
        "normalization": {
            "shoulder_width_2d": round(shoulder_width_2d, 6),
            "shoulder_width_3d": round(shoulder_width_3d, 6),
            "shoulder_center_z_3d": round(shoulder_center_z, 6),
        },
    }
    return row, None


def iter_quality_mask_groups(path: Path):
    current_sequence_id: str | None = None
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as fp:
        for line_number, line in enumerate(fp, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            row = json.loads(stripped)
            sequence_id = str(row["sequence_id"])
            if current_sequence_id is None:
                current_sequence_id = sequence_id
            if sequence_id != current_sequence_id:
                yield current_sequence_id, rows
                current_sequence_id = sequence_id
                rows = []
            rows.append(row)
    if current_sequence_id is not None:
        yield current_sequence_id, rows


def process_sequence_group(
    sequence_id: str, mask_rows: list[dict[str, Any]], sequence_dir_string: str | None, dataset_kind: str
) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    rows: list[dict[str, Any]] = []
    if sequence_dir_string is None:
        counts["sequence_missing"] += 1
        return {"rows": rows, "counts": dict(counts), "sequence_summary": None}

    sequence_dir = Path(sequence_dir_string)
    frame_files = iter_frame_files(sequence_dir)
    for mask_row in mask_rows:
        frame_position = int(mask_row["frame_position"])
        if frame_position < 0 or frame_position >= len(frame_files):
            counts["frame_position_out_of_range"] += 1
            continue
        row, skip_reason = build_dataset_row(sequence_id, frame_files[frame_position], mask_row, dataset_kind)
        if row is None:
            counts[f"skipped.{skip_reason}"] += 1
            continue
        rows.append(row)
        counts["rows"] += 1
        for hand in ("left", "right"):
            hand_mask = row["masks"].get(hand) or {}
            for target in ("wrist", "palm", "finger"):
                key = f"use_{target}_depth"
                counts[f"{hand}.{target}.usable" if hand_mask.get(key) else f"{hand}.{target}.rejected"] += 1
    sequence_summary = {
        "sequence_id": sequence_id,
        "input_mask_rows": len(mask_rows),
        "output_rows": len(rows),
        "counts": dict(sorted(counts.items())),
    }
    return {"rows": rows, "counts": dict(counts), "sequence_summary": sequence_summary}


class DatasetWriter:
    def __init__(self, output_jsonl: Path | None, shard_dir: Path | None, shard_size: int, dataset_kind: str):
        self.output_jsonl = output_jsonl
        self.shard_dir = shard_dir
        self.shard_size = shard_size
        self.dataset_kind = dataset_kind
        self.single_fp = None
        self.shard_fp = None
        self.shard_index = 0
        self.rows_in_current_shard = 0
        self.shard_files: list[str] = []

    def __enter__(self):
        if self.output_jsonl:
            self.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
            self.single_fp = self.output_jsonl.open("w", encoding="utf-8")
        if self.shard_dir:
            self.shard_dir.mkdir(parents=True, exist_ok=True)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.single_fp:
            self.single_fp.close()
        if self.shard_fp:
            self.shard_fp.close()

    def _ensure_shard(self):
        if not self.shard_dir:
            return
        if self.shard_fp is not None and self.rows_in_current_shard < self.shard_size:
            return
        if self.shard_fp is not None:
            self.shard_fp.close()
        shard_name = f"{self.dataset_kind}_hand_lifting_dataset_{self.shard_index:05d}.jsonl"
        shard_path = self.shard_dir / shard_name
        self.shard_fp = shard_path.open("w", encoding="utf-8")
        self.shard_files.append(str(shard_path))
        self.shard_index += 1
        self.rows_in_current_shard = 0

    def write_rows(self, rows: list[dict[str, Any]]) -> int:
        written = 0
        for row in rows:
            line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            if self.single_fp:
                self.single_fp.write(line)
            if self.shard_dir:
                self._ensure_shard()
                assert self.shard_fp is not None
                self.shard_fp.write(line)
                self.rows_in_current_shard += 1
            written += 1
        return written


def ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 6)


def summarize_counts(counts: Counter[str], sequence_count: int, shard_files: list[str]) -> dict[str, Any]:
    row_count = counts.get("rows", 0)
    summary = {
        "sequence_count": sequence_count,
        "row_count": row_count,
        "skipped_counts": {key: value for key, value in sorted(counts.items()) if key.startswith("skipped.")},
        "sequence_missing": counts.get("sequence_missing", 0),
        "frame_position_out_of_range": counts.get("frame_position_out_of_range", 0),
        "target_usable_ratios": {},
        "shard_files": shard_files,
    }
    for hand in ("left", "right"):
        for target in ("wrist", "palm", "finger"):
            usable = counts.get(f"{hand}.{target}.usable", 0)
            rejected = counts.get(f"{hand}.{target}.rejected", 0)
            summary["target_usable_ratios"][f"{hand}.{target}"] = ratio(usable, usable + rejected)
    return summary


def expand_keypoint_root(root: Path) -> list[Path]:
    if not root.exists():
        raise FileNotFoundError(root)
    numeric_children = [
        child
        for child in sorted(root.iterdir())
        if child.is_dir() and child.name.isdigit() and list(child.glob("*_F"))
    ]
    return numeric_children or [root]


def infer_dataset_kind(path: Path) -> str:
    lowered = str(path).lower()
    if "sen" in lowered:
        return "sen"
    if "word" in lowered or "morpheme" in lowered:
        return "word"
    raise ValueError(f"Cannot infer dataset kind from path: {path}")


def run_convenience_mode(args: argparse.Namespace) -> int:
    roots_by_kind: dict[str, list[Path]] = {"word": [], "sen": []}
    for root in args.input_roots:
        roots_by_kind[infer_dataset_kind(root)].extend(expand_keypoint_root(root))

    manifest: dict[str, Any] = {
        "schema_version": "hand-lifting-dataset-v0.5/convenience-v1",
        "output_dir": str(args.output_dir),
        "quality_mask_root": str(args.quality_mask_root),
        "datasets": {},
    }
    for kind, roots in roots_by_kind.items():
        if not roots:
            continue
        quality_mask = args.quality_mask_root / f"quality_mask_{kind}_train_all_F.jsonl"
        if not quality_mask.exists():
            raise FileNotFoundError(quality_mask)
        shard_dir = args.output_dir / kind
        summary_output = args.output_dir / f"{kind}_hand_lifting_dataset_v0_5_summary.json"
        command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--quality-mask",
            str(quality_mask),
            "--shard-dir",
            str(shard_dir),
            "--summary-output",
            str(summary_output),
            "--dataset-kind",
            kind,
            "--sequence-glob",
            args.sequence_glob,
            "--shard-size",
            str(args.shard_size),
            "--workers",
            str(args.workers),
        ]
        for root in roots:
            command.extend(["--keypoint-root", str(root)])
        subprocess.run(command, check=True)
        manifest["datasets"][kind] = {
            "keypoint_roots": [str(root) for root in roots],
            "quality_mask": str(quality_mask),
            "shard_dir": str(shard_dir),
            "summary_output": str(summary_output),
        }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / "hand_lifting_dataset_v0_5_convenience_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Convenience manifest: {manifest_path}")
    return 0


def main() -> int:
    args = parse_args()
    if args.input_roots:
        return run_convenience_mode(args)
    sequence_index = build_sequence_index(args.keypoint_root, args.sequence_glob)
    worker_count = resolve_worker_count(args.workers, len(sequence_index))
    max_pending = max(worker_count * 4, 1)
    counts: Counter[str] = Counter()
    sequence_summaries: list[dict[str, Any]] = []
    sequence_count = 0

    def consume_result(result: dict[str, Any], writer: DatasetWriter) -> None:
        counts.update(result["counts"])
        if result.get("sequence_summary"):
            sequence_summaries.append(result["sequence_summary"])
        writer.write_rows(result["rows"])

    with DatasetWriter(args.output_jsonl, args.shard_dir, args.shard_size, args.dataset_kind) as writer:
        if worker_count <= 1:
            for sequence_id, mask_rows in iter_quality_mask_groups(args.quality_mask):
                sequence_count += 1
                result = process_sequence_group(
                    sequence_id, mask_rows, sequence_index.get(sequence_id), args.dataset_kind
                )
                consume_result(result, writer)
        else:
            pending = set()
            with ProcessPoolExecutor(max_workers=worker_count) as executor:
                for sequence_id, mask_rows in iter_quality_mask_groups(args.quality_mask):
                    sequence_count += 1
                    pending.add(
                        executor.submit(
                            process_sequence_group,
                            sequence_id,
                            mask_rows,
                            sequence_index.get(sequence_id),
                            args.dataset_kind,
                        )
                    )
                    if len(pending) >= max_pending:
                        done, pending = wait(pending, return_when=FIRST_COMPLETED)
                        for future in done:
                            consume_result(future.result(), writer)
                while pending:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        consume_result(future.result(), writer)

        shard_files = writer.shard_files

    sequence_summaries.sort(key=lambda item: item["sequence_id"])
    summary = {
        "config": {
            "dataset_kind": args.dataset_kind,
            "keypoint_roots": [str(path) for path in args.keypoint_root],
            "quality_mask": str(args.quality_mask),
            "output_jsonl": str(args.output_jsonl) if args.output_jsonl else None,
            "shard_dir": str(args.shard_dir) if args.shard_dir else None,
            "shard_size": args.shard_size,
            "sequence_glob": args.sequence_glob,
            "workers": worker_count,
            "pose_input_indices": list(POSE_INPUT_INDICES),
            "label_units": "v0.5 root-relative arm+hand z normalized by 3D shoulder width",
            "target_layout": {
                "input_dim": 171,
                "output_dim": 46,
                "arm_targets": [
                    "left_shoulder",
                    "right_shoulder",
                    "left_elbow",
                    "right_elbow",
                    "left_wrist",
                    "right_wrist",
                ],
                "hand_targets": "left/right hand joints 1..20; hand joint 0 shares pose wrist z",
            },
        },
        "summary": summarize_counts(counts, sequence_count, shard_files),
        "sequences": sequence_summaries,
    }
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Sequences: {sequence_count}")
    print(f"Rows: {summary['summary']['row_count']}")
    print(f"Summary: {args.summary_output}")
    if args.output_jsonl:
        print(f"Dataset JSONL: {args.output_jsonl}")
    if args.shard_dir:
        print(f"Shard files: {len(shard_files)}")
    print(f"Target usable ratios: {summary['summary']['target_usable_ratios']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
