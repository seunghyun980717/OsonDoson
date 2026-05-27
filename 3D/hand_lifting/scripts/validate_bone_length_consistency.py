#!/usr/bin/env python3
"""Validate per-sequence 3D hand bone length consistency.

The script scans sequence directories ending with "_F", reads frame JSON files,
computes 3D hand bone lengths in millimeters, and writes:

1. A JSON report with per-sequence/per-bone statistics.
2. Histogram PNG files for aggregate bone length distributions.

Example:
    python scripts/validate_bone_length_consistency.py \
        --input-root "<dataset_root>" \
        --output-dir artifacts/bone_length_consistency_F
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median, pstdev
from typing import Any, Iterable


FRAME_RE = re.compile(r"_(\d+)_keypoints\.json$", re.IGNORECASE)


HAND_KEYS = {
    "left": "hand_left_keypoints_3d",
    "right": "hand_right_keypoints_3d",
}


JOINT_NAMES = {
    0: "wrist",
    1: "thumb_cmc",
    2: "thumb_mcp",
    3: "thumb_ip",
    4: "thumb_tip",
    5: "index_mcp",
    6: "index_pip",
    7: "index_dip",
    8: "index_tip",
    9: "middle_mcp",
    10: "middle_pip",
    11: "middle_dip",
    12: "middle_tip",
    13: "ring_mcp",
    14: "ring_pip",
    15: "ring_dip",
    16: "ring_tip",
    17: "pinky_mcp",
    18: "pinky_pip",
    19: "pinky_dip",
    20: "pinky_tip",
}


BASE_BONES = [
    (0, 1, "thumb_wrist_to_cmc"),
    (1, 2, "thumb_cmc_to_mcp"),
    (2, 3, "thumb_mcp_to_ip"),
    (3, 4, "thumb_ip_to_tip"),
    (0, 5, "index_wrist_to_mcp"),
    (5, 6, "index_mcp_to_pip"),
    (6, 7, "index_pip_to_dip"),
    (7, 8, "index_dip_to_tip"),
    (0, 9, "middle_wrist_to_mcp"),
    (9, 10, "middle_mcp_to_pip"),
    (10, 11, "middle_pip_to_dip"),
    (11, 12, "middle_dip_to_tip"),
    (0, 13, "ring_wrist_to_mcp"),
    (13, 14, "ring_mcp_to_pip"),
    (14, 15, "ring_pip_to_dip"),
    (15, 16, "ring_dip_to_tip"),
    (0, 17, "pinky_wrist_to_mcp"),
    (17, 18, "pinky_mcp_to_pip"),
    (18, 19, "pinky_pip_to_dip"),
    (19, 20, "pinky_dip_to_tip"),
]


PALM_BONES = [
    (2, 5, "palm_thumb_mcp_to_index_mcp"),
    (5, 9, "palm_index_mcp_to_middle_mcp"),
    (9, 13, "palm_middle_mcp_to_ring_mcp"),
    (13, 17, "palm_ring_mcp_to_pinky_mcp"),
]


@dataclass(frozen=True)
class LengthSample:
    frame_index: int
    value_mm: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check 3D hand bone length consistency for F-view sequences."
    )
    parser.add_argument(
        "--input-root",
        required=True,
        type=Path,
        help="Directory containing sequence folders such as NIA_SL_WORD0001_REAL01_F.",
    )
    parser.add_argument(
        "--output-dir",
        default=Path("artifacts/bone_length_consistency_F"),
        type=Path,
        help="Directory where JSON report and histograms are written.",
    )
    parser.add_argument(
        "--sequence-glob",
        default="*_F",
        help="Glob for selecting sequence directories. Default: *_F",
    )
    parser.add_argument(
        "--min-conf",
        default=0.0,
        type=float,
        help="Minimum confidence for both endpoints. Points with confidence <= this are ignored.",
    )
    parser.add_argument(
        "--outlier-sigma",
        default=2.0,
        type=float,
        help="Mark lengths outside mean +/- N*std as outliers. Default: 2.0",
    )
    parser.add_argument(
        "--include-palm-bones",
        action="store_true",
        help="Also measure MCP-to-MCP palm internal distances.",
    )
    parser.add_argument(
        "--max-histograms",
        default=48,
        type=int,
        help="Maximum number of aggregate histogram PNG files to create.",
    )
    parser.add_argument(
        "--coordinate-unit",
        default="auto",
        choices=("auto", "meter", "millimeter"),
        help=(
            "3D coordinate unit. 'auto' infers per frame from pose shoulder width "
            "or z magnitude. Default: auto."
        ),
    )
    return parser.parse_args()


def iter_sequence_dirs(input_root: Path, sequence_glob: str) -> list[Path]:
    if not input_root.exists():
        raise FileNotFoundError(f"Input root does not exist: {input_root}")
    return sorted(path for path in input_root.glob(sequence_glob) if path.is_dir())


def frame_index_from_path(path: Path) -> int:
    match = FRAME_RE.search(path.name)
    if not match:
        return -1
    return int(match.group(1))


def iter_frame_files(sequence_dir: Path) -> list[Path]:
    return sorted(
        sequence_dir.glob("*_keypoints.json"),
        key=lambda path: (frame_index_from_path(path), path.name),
    )


def get_people(payload: dict[str, Any]) -> dict[str, Any] | None:
    people = payload.get("people")
    if isinstance(people, dict):
        return people
    if isinstance(people, list) and people and isinstance(people[0], dict):
        return people[0]
    return None


def parse_hand_points(
    people: dict[str, Any], hand_key: str, min_conf: float
) -> list[tuple[float, float, float] | None] | None:
    raw = people.get(hand_key)
    if not isinstance(raw, list) or len(raw) < 21 * 4:
        return None

    points: list[tuple[float, float, float] | None] = []
    for idx in range(21):
        offset = idx * 4
        try:
            x = float(raw[offset])
            y = float(raw[offset + 1])
            z = float(raw[offset + 2])
            conf = float(raw[offset + 3])
        except (TypeError, ValueError):
            points.append(None)
            continue

        if conf <= min_conf or not all(math.isfinite(v) for v in (x, y, z)):
            points.append(None)
            continue
        if abs(x) < 1e-12 and abs(y) < 1e-12 and abs(z) < 1e-12:
            points.append(None)
            continue
        points.append((x, y, z))

    return points


def euclidean_scaled_mm(
    p1: tuple[float, float, float], p2: tuple[float, float, float], scale_to_mm: float
) -> float:
    dx = p1[0] - p2[0]
    dy = p1[1] - p2[1]
    dz = p1[2] - p2[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz) * scale_to_mm


def parse_3d_point(
    raw: Any, idx: int, stride: int, min_conf: float
) -> tuple[float, float, float] | None:
    if not isinstance(raw, list) or len(raw) < (idx + 1) * stride:
        return None
    offset = idx * stride
    try:
        x = float(raw[offset])
        y = float(raw[offset + 1])
        z = float(raw[offset + 2])
        conf = float(raw[offset + 3])
    except (TypeError, ValueError):
        return None

    if conf <= min_conf or not all(math.isfinite(v) for v in (x, y, z)):
        return None
    if abs(x) < 1e-12 and abs(y) < 1e-12 and abs(z) < 1e-12:
        return None
    return (x, y, z)


def infer_scale_to_mm(people: dict[str, Any], coordinate_unit: str) -> float:
    if coordinate_unit == "meter":
        return 1000.0
    if coordinate_unit == "millimeter":
        return 1.0

    pose_raw = people.get("pose_keypoints_3d")
    left_shoulder = parse_3d_point(pose_raw, 2, 4, min_conf=0.0)
    right_shoulder = parse_3d_point(pose_raw, 5, 4, min_conf=0.0)
    if left_shoulder is not None and right_shoulder is not None:
        raw_shoulder_width = math.sqrt(
            (left_shoulder[0] - right_shoulder[0]) ** 2
            + (left_shoulder[1] - right_shoulder[1]) ** 2
            + (left_shoulder[2] - right_shoulder[2]) ** 2
        )
        if raw_shoulder_width > 10.0:
            return 1.0
        return 1000.0

    # Fallback: AIHub meter-space z is roughly 2.x, while millimeter-space z is
    # roughly 2000.x. A threshold of 10 leaves a large margin between them.
    for hand_key in HAND_KEYS.values():
        raw = people.get(hand_key)
        point = parse_3d_point(raw, 0, 4, min_conf=0.0)
        if point is None:
            continue
        if abs(point[2]) > 10.0:
            return 1.0
        return 1000.0

    return 1000.0


def percentile(sorted_values: list[float], q: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return sorted_values[low]
    weight = pos - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def status_from_cv(cv: float | None) -> str:
    if cv is None:
        return "insufficient_data"
    if cv < 0.03:
        return "good"
    if cv < 0.05:
        return "watch"
    return "unstable"


def summarize_samples(
    samples: list[LengthSample], outlier_sigma: float
) -> dict[str, Any]:
    values = [sample.value_mm for sample in samples]
    if not values:
        return {
            "valid_count": 0,
            "mean_mm": None,
            "std_mm": None,
            "cv": None,
            "min_mm": None,
            "max_mm": None,
            "median_mm": None,
            "mad_mm": None,
            "p05_mm": None,
            "p95_mm": None,
            "status": "insufficient_data",
            "outlier_frames": [],
        }

    values_sorted = sorted(values)
    avg = mean(values)
    std = pstdev(values) if len(values) > 1 else 0.0
    med = median(values)
    mad = median(abs(value - med) for value in values)
    cv = std / avg if avg > 0.0 else None

    outlier_frames: list[int] = []
    if std > 0.0:
        low = avg - outlier_sigma * std
        high = avg + outlier_sigma * std
        outlier_frames = [
            sample.frame_index
            for sample in samples
            if sample.value_mm < low or sample.value_mm > high
        ]

    return {
        "valid_count": len(values),
        "mean_mm": round(avg, 6),
        "std_mm": round(std, 6),
        "cv": round(cv, 6) if cv is not None else None,
        "min_mm": round(min(values), 6),
        "max_mm": round(max(values), 6),
        "median_mm": round(med, 6),
        "mad_mm": round(mad, 6),
        "p05_mm": round(percentile(values_sorted, 0.05), 6),
        "p95_mm": round(percentile(values_sorted, 0.95), 6),
        "status": status_from_cv(cv),
        "outlier_frames": outlier_frames,
    }


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as fp:
            payload = json.load(fp)
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def analyze_sequence(
    sequence_dir: Path,
    bones: list[tuple[int, int, str]],
    min_conf: float,
    outlier_sigma: float,
    coordinate_unit: str,
    aggregate_samples: dict[str, list[float]],
) -> dict[str, Any]:
    frame_files = iter_frame_files(sequence_dir)
    per_bone_samples: dict[str, list[LengthSample]] = defaultdict(list)
    invalid_frames: list[dict[str, Any]] = []
    hand_valid_frame_counts = {"left": 0, "right": 0}
    scale_counts: dict[str, int] = defaultdict(int)

    for frame_file in frame_files:
        frame_index = frame_index_from_path(frame_file)
        payload = load_json(frame_file)
        if payload is None:
            invalid_frames.append(
                {"frame": frame_index, "file": frame_file.name, "reason": "invalid_json"}
            )
            continue

        people = get_people(payload)
        if people is None:
            invalid_frames.append(
                {"frame": frame_index, "file": frame_file.name, "reason": "missing_people"}
            )
            continue

        scale_to_mm = infer_scale_to_mm(people, coordinate_unit)
        scale_counts["millimeter" if scale_to_mm == 1.0 else "meter"] += 1

        for hand, hand_key in HAND_KEYS.items():
            points = parse_hand_points(people, hand_key, min_conf)
            if points is None:
                continue

            hand_had_sample = False
            for start_idx, end_idx, bone_name in bones:
                start = points[start_idx]
                end = points[end_idx]
                if start is None or end is None:
                    continue
                value_mm = euclidean_scaled_mm(start, end, scale_to_mm)
                key = f"{hand}.{bone_name}"
                per_bone_samples[key].append(LengthSample(frame_index, value_mm))
                aggregate_samples[key].append(value_mm)
                hand_had_sample = True

            if hand_had_sample:
                hand_valid_frame_counts[hand] += 1

    bone_stats = {
        bone_key: summarize_samples(samples, outlier_sigma)
        for bone_key, samples in sorted(per_bone_samples.items())
    }

    status_counts = defaultdict(int)
    for stats in bone_stats.values():
        status_counts[stats["status"]] += 1

    return {
        "sequence_id": sequence_dir.name,
        "sequence_dir": str(sequence_dir),
        "frame_count": len(frame_files),
        "hand_valid_frame_counts": hand_valid_frame_counts,
        "coordinate_unit_frame_counts": dict(sorted(scale_counts.items())),
        "invalid_frame_count": len(invalid_frames),
        "invalid_frames_preview": invalid_frames[:20],
        "status_counts": dict(sorted(status_counts.items())),
        "bones": bone_stats,
    }


def summarize_aggregate(
    aggregate_samples: dict[str, list[float]], outlier_sigma: float
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for bone_key, values in sorted(aggregate_samples.items()):
        samples = [LengthSample(-1, value) for value in values]
        stats = summarize_samples(samples, outlier_sigma)
        stats.pop("outlier_frames", None)
        summary[bone_key] = stats
    return summary


def write_histograms(
    aggregate_samples: dict[str, list[float]], output_dir: Path, max_histograms: int
) -> list[str]:
    if max_histograms <= 0:
        return []

    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    hist_dir = output_dir / "histograms"
    hist_dir.mkdir(parents=True, exist_ok=True)

    written: list[str] = []
    sorted_items = sorted(
        aggregate_samples.items(),
        key=lambda item: pstdev(item[1]) / mean(item[1]) if len(item[1]) > 1 and mean(item[1]) > 0 else 0,
        reverse=True,
    )

    for bone_key, values in sorted_items[:max_histograms]:
        if not values:
            continue
        fig, ax = plt.subplots(figsize=(8, 4.5))
        ax.hist(values, bins=40, color="#4C78A8", edgecolor="white")
        ax.set_title(bone_key)
        ax.set_xlabel("length (mm)")
        ax.set_ylabel("count")
        ax.grid(axis="y", alpha=0.25)
        fig.tight_layout()

        file_name = f"{bone_key.replace('.', '__')}.png"
        output_path = hist_dir / file_name
        fig.savefig(output_path, dpi=150)
        plt.close(fig)
        written.append(str(output_path))

    return written


def worst_bones(sequence_reports: Iterable[dict[str, Any]], limit: int = 30) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for report in sequence_reports:
        for bone_key, stats in report["bones"].items():
            cv = stats.get("cv")
            if cv is None:
                continue
            rows.append(
                {
                    "sequence_id": report["sequence_id"],
                    "bone": bone_key,
                    "cv": cv,
                    "std_mm": stats["std_mm"],
                    "mean_mm": stats["mean_mm"],
                    "valid_count": stats["valid_count"],
                    "status": stats["status"],
                    "outlier_count": len(stats["outlier_frames"]),
                }
            )
    return sorted(rows, key=lambda row: (row["cv"], row["std_mm"]), reverse=True)[:limit]


def main() -> int:
    args = parse_args()
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    bones = list(BASE_BONES)
    if args.include_palm_bones:
        bones.extend(PALM_BONES)

    sequence_dirs = iter_sequence_dirs(args.input_root, args.sequence_glob)
    aggregate_samples: dict[str, list[float]] = defaultdict(list)

    sequence_reports = [
        analyze_sequence(
            sequence_dir=sequence_dir,
            bones=bones,
            min_conf=args.min_conf,
            outlier_sigma=args.outlier_sigma,
            coordinate_unit=args.coordinate_unit,
            aggregate_samples=aggregate_samples,
        )
        for sequence_dir in sequence_dirs
    ]

    aggregate = summarize_aggregate(aggregate_samples, args.outlier_sigma)
    histogram_files = write_histograms(aggregate_samples, output_dir, args.max_histograms)

    report = {
        "config": {
            "input_root": str(args.input_root),
            "sequence_glob": args.sequence_glob,
            "min_conf": args.min_conf,
            "outlier_sigma": args.outlier_sigma,
            "include_palm_bones": args.include_palm_bones,
            "coordinate_unit": args.coordinate_unit,
            "joint_mapping": JOINT_NAMES,
            "bone_count_per_hand": len(bones),
            "expected_total_hand_bones": len(bones) * 2,
        },
        "summary": {
            "sequence_count": len(sequence_reports),
            "aggregate_bone_count": len(aggregate),
            "histogram_count": len(histogram_files),
            "worst_bones_by_cv": worst_bones(sequence_reports),
        },
        "aggregate": aggregate,
        "sequences": sequence_reports,
        "histogram_files": histogram_files,
    }

    report_path = output_dir / "bone_length_consistency_report.json"
    with report_path.open("w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=2)

    print(f"Scanned sequences: {len(sequence_reports)}")
    print(f"Report: {report_path}")
    print(f"Histograms: {output_dir / 'histograms'} ({len(histogram_files)} files)")
    if report["summary"]["worst_bones_by_cv"]:
        print("Worst bones by CV:")
        for row in report["summary"]["worst_bones_by_cv"][:10]:
            print(
                f"  {row['sequence_id']} {row['bone']} "
                f"cv={row['cv']:.4f} std_mm={row['std_mm']:.3f} "
                f"mean_mm={row['mean_mm']:.3f} status={row['status']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
