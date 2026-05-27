#!/usr/bin/env python3
"""Validate whether AIHub 3D keypoints reproject back to their 2D keypoints.

This checks the camera/model consistency that bone-length validation cannot
answer. It projects pose/hand 3D points through each frame's camparam and
measures pixel error against the corresponding 2D keypoints.

Example:
    python scripts/validate_3d_reprojection_consistency.py \
        --input-root "D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_word_keypoint/01" \
        --output-dir artifacts/reprojection_F_smoke \
        --sequence-glob NIA_SL_WORD0001_REAL01_F
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import random
import re
from collections import Counter
from dataclasses import dataclass, field
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any


FRAME_RE = re.compile(r"_(\d+)_keypoints\.json$", re.IGNORECASE)

KEYPOINT_SETS = {
    "pose": ("pose_keypoints_2d", "pose_keypoints_3d", 25),
    "left_hand": ("hand_left_keypoints_2d", "hand_left_keypoints_3d", 21),
    "right_hand": ("hand_right_keypoints_2d", "hand_right_keypoints_3d", 21),
}


@dataclass
class Reservoir:
    limit: int
    values: list[float] = field(default_factory=list)
    seen: int = 0

    def add(self, value: float) -> None:
        self.seen += 1
        if self.limit <= 0:
            return
        if len(self.values) < self.limit:
            self.values.append(value)
            return
        index = random.randrange(self.seen)
        if index < self.limit:
            self.values[index] = value


@dataclass
class RunningStats:
    count: int = 0
    mean: float = 0.0
    m2: float = 0.0
    min_value: float | None = None
    max_value: float | None = None
    sample: Reservoir = field(default_factory=lambda: Reservoir(0))

    def add(self, value: float) -> None:
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        delta2 = value - self.mean
        self.m2 += delta * delta2
        self.min_value = value if self.min_value is None else min(self.min_value, value)
        self.max_value = value if self.max_value is None else max(self.max_value, value)
        self.sample.add(value)

    @property
    def std(self) -> float | None:
        if self.count <= 1:
            return 0.0 if self.count == 1 else None
        return math.sqrt(self.m2 / self.count)

    def merge(self, other: "RunningStats") -> None:
        if other.count == 0:
            return
        if self.count == 0:
            self.count = other.count
            self.mean = other.mean
            self.m2 = other.m2
            self.min_value = other.min_value
            self.max_value = other.max_value
        else:
            combined_count = self.count + other.count
            delta = other.mean - self.mean
            self.mean = (
                (self.mean * self.count + other.mean * other.count) / combined_count
            )
            self.m2 = (
                self.m2
                + other.m2
                + delta * delta * self.count * other.count / combined_count
            )
            self.count = combined_count
            if other.min_value is not None:
                self.min_value = (
                    other.min_value
                    if self.min_value is None
                    else min(self.min_value, other.min_value)
                )
            if other.max_value is not None:
                self.max_value = (
                    other.max_value
                    if self.max_value is None
                    else max(self.max_value, other.max_value)
                )

        for value in other.sample.values:
            self.sample.add(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure 3D->2D reprojection error for AIHub pose/hand keypoints."
    )
    parser.add_argument(
        "--input-root",
        required=True,
        type=Path,
        help="Directory containing sequence folders such as NIA_SL_WORD0001_REAL01_F.",
    )
    parser.add_argument(
        "--output-dir",
        default=Path("artifacts/reprojection_consistency_F"),
        type=Path,
        help="Directory where JSON report and histograms are written.",
    )
    parser.add_argument(
        "--sequence-glob",
        default="*_F",
        help="Glob for selecting sequence directories. Default: *_F",
    )
    parser.add_argument(
        "--min-conf-2d",
        default=0.0,
        type=float,
        help="Minimum 2D confidence. Points with confidence <= this are ignored.",
    )
    parser.add_argument(
        "--min-conf-3d",
        default=0.0,
        type=float,
        help="Minimum 3D confidence. Points with confidence <= this are ignored.",
    )
    parser.add_argument(
        "--max-histograms",
        default=20,
        type=int,
        help="Maximum number of reprojection error histogram PNG files.",
    )
    parser.add_argument(
        "--max-samples-per-bucket",
        default=50000,
        type=int,
        help="Reservoir sample size per joint/group for percentiles and histograms.",
    )
    parser.add_argument(
        "--pass-p95-px",
        default=10.0,
        type=float,
        help="Summary pass threshold for aggregate sampled p95 reprojection error.",
    )
    parser.add_argument(
        "--distortion-mode",
        default="apply",
        choices=("apply", "none"),
        help=(
            "Use camparam distortion coefficients during projection, or ignore "
            "them if 2D keypoints are already undistorted. Default: apply."
        ),
    )
    parser.add_argument(
        "--random-seed",
        default=13,
        type=int,
        help="Random seed for deterministic reservoir sampling.",
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


def parse_float_list(raw: Any) -> list[float] | None:
    if isinstance(raw, str):
        raw = raw.split()
    if not isinstance(raw, list):
        return None
    try:
        return [float(value) for value in raw]
    except (TypeError, ValueError):
        return None


def parse_camera(payload: dict[str, Any]) -> tuple[list[float], list[float]]:
    camparam = payload.get("camparam")
    if not isinstance(camparam, dict):
        raise ValueError("missing camparam")
    intrinsics = camparam.get("Intrinsics")
    if not isinstance(intrinsics, dict):
        raise ValueError("missing camparam.Intrinsics")
    k = parse_float_list(intrinsics.get("data"))
    if k is None or len(k) < 9:
        raise ValueError("invalid intrinsics")

    distortion = camparam.get("Distortion")
    d = []
    if isinstance(distortion, dict):
        parsed = parse_float_list(distortion.get("data"))
        if parsed is not None:
            d = parsed
    while len(d) < 5:
        d.append(0.0)
    return k, d[:5]


def parse_2d(raw: Any, idx: int, min_conf: float) -> tuple[float, float] | None:
    if not isinstance(raw, list) or len(raw) < (idx + 1) * 3:
        return None
    offset = idx * 3
    try:
        x = float(raw[offset])
        y = float(raw[offset + 1])
        conf = float(raw[offset + 2])
    except (TypeError, ValueError):
        return None
    if conf <= min_conf or not all(math.isfinite(v) for v in (x, y)):
        return None
    return (x, y)


def parse_3d(raw: Any, idx: int, min_conf: float) -> tuple[float, float, float] | None:
    if not isinstance(raw, list) or len(raw) < (idx + 1) * 4:
        return None
    offset = idx * 4
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


def project_point(
    point: tuple[float, float, float],
    k: list[float],
    d: list[float],
    distortion_mode: str,
) -> tuple[float, float] | None:
    x3, y3, z3 = point
    if z3 <= 1e-12:
        return None

    x = x3 / z3
    y = y3 / z3
    if distortion_mode == "apply":
        k1, k2, p1, p2, k3 = d
        r2 = x * x + y * y
        radial = 1.0 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2
        x_dist = x * radial + 2.0 * p1 * x * y + p2 * (r2 + 2.0 * x * x)
        y_dist = y * radial + p1 * (r2 + 2.0 * y * y) + 2.0 * p2 * x * y
    else:
        x_dist = x
        y_dist = y

    fx, skew, cx = k[0], k[1], k[2]
    fy, cy = k[4], k[5]
    return (fx * x_dist + skew * y_dist + cx, fy * y_dist + cy)


def pixel_error(projected: tuple[float, float], target: tuple[float, float]) -> float:
    return math.hypot(projected[0] - target[0], projected[1] - target[1])


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[int(position)]
    weight = position - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def stats_to_dict(stats: RunningStats) -> dict[str, Any]:
    sample = stats.sample.values
    return {
        "count": stats.count,
        "mean_px": round(stats.mean, 6) if stats.count else None,
        "std_px": round(stats.std, 6) if stats.std is not None else None,
        "min_px": round(stats.min_value, 6) if stats.min_value is not None else None,
        "max_px": round(stats.max_value, 6) if stats.max_value is not None else None,
        "sample_count": len(sample),
        "p50_px": round(percentile(sample, 0.50), 6) if sample else None,
        "p90_px": round(percentile(sample, 0.90), 6) if sample else None,
        "p95_px": round(percentile(sample, 0.95), 6) if sample else None,
        "p99_px": round(percentile(sample, 0.99), 6) if sample else None,
    }


def make_stats(limit: int) -> RunningStats:
    return RunningStats(sample=Reservoir(limit))


def analyze_sequence(
    sequence_dir: Path,
    min_conf_2d: float,
    min_conf_3d: float,
    distortion_mode: str,
    sample_limit: int,
    aggregate_stats: dict[str, RunningStats],
) -> dict[str, Any]:
    frame_files = iter_frame_files(sequence_dir)
    sequence_stats = {
        "all": make_stats(sample_limit),
        **{group: make_stats(sample_limit) for group in KEYPOINT_SETS},
    }
    skip_counts: Counter[str] = Counter()

    for frame_file in frame_files:
        try:
            payload = json.loads(frame_file.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                skip_counts["invalid_json"] += 1
                continue
            people = get_people(payload)
            if people is None:
                skip_counts["missing_people"] += 1
                continue
            k, d = parse_camera(payload)
        except (OSError, json.JSONDecodeError, ValueError):
            skip_counts["invalid_frame"] += 1
            continue

        for group, (key_2d, key_3d, count) in KEYPOINT_SETS.items():
            raw_2d = people.get(key_2d)
            raw_3d = people.get(key_3d)
            for idx in range(count):
                point_2d = parse_2d(raw_2d, idx, min_conf_2d)
                point_3d = parse_3d(raw_3d, idx, min_conf_3d)
                if point_2d is None or point_3d is None:
                    skip_counts[f"{group}.missing_or_low_conf"] += 1
                    continue
                projected = project_point(point_3d, k, d, distortion_mode)
                if projected is None:
                    skip_counts[f"{group}.invalid_projection"] += 1
                    continue
                error = pixel_error(projected, point_2d)
                if not math.isfinite(error):
                    skip_counts[f"{group}.invalid_error"] += 1
                    continue

                joint_key = f"{group}.{idx:02d}"
                if joint_key not in aggregate_stats:
                    aggregate_stats[joint_key] = make_stats(sample_limit)
                for stats in (
                    sequence_stats["all"],
                    sequence_stats[group],
                    aggregate_stats["all"],
                    aggregate_stats[group],
                    aggregate_stats[joint_key],
                ):
                    stats.add(error)

    return {
        "sequence_id": sequence_dir.name,
        "sequence_dir": str(sequence_dir),
        "frame_count": len(frame_files),
        "stats": {key: stats_to_dict(value) for key, value in sequence_stats.items()},
        "skip_counts": dict(sorted(skip_counts.items())),
    }


def make_aggregate_stats(sample_limit: int) -> dict[str, RunningStats]:
    return {
        "all": make_stats(sample_limit),
        **{group: make_stats(sample_limit) for group in KEYPOINT_SETS},
    }


def merge_aggregate_stats(
    target: dict[str, RunningStats], source: dict[str, RunningStats], sample_limit: int
) -> None:
    for key, stats in source.items():
        if key not in target:
            target[key] = make_stats(sample_limit)
        target[key].merge(stats)


def chunk_paths(paths: list[Path], worker_count: int) -> list[list[Path]]:
    chunks = [[] for _ in range(worker_count)]
    for index, path in enumerate(paths):
        chunks[index % worker_count].append(path)
    return [chunk for chunk in chunks if chunk]


def analyze_sequence_batch(
    sequence_dirs: list[Path],
    min_conf_2d: float,
    min_conf_3d: float,
    distortion_mode: str,
    sample_limit: int,
    random_seed: int,
) -> dict[str, Any]:
    random.seed(random_seed)
    aggregate_stats = make_aggregate_stats(sample_limit)
    sequences = [
        analyze_sequence(
            sequence_dir=sequence_dir,
            min_conf_2d=min_conf_2d,
            min_conf_3d=min_conf_3d,
            distortion_mode=distortion_mode,
            sample_limit=sample_limit,
            aggregate_stats=aggregate_stats,
        )
        for sequence_dir in sequence_dirs
    ]
    return {"sequences": sequences, "aggregate_stats": aggregate_stats}


def write_histograms(
    aggregate_stats: dict[str, RunningStats], output_dir: Path, max_histograms: int
) -> list[str]:
    if max_histograms <= 0:
        return []
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    hist_dir = output_dir / "histograms"
    hist_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for key, stats in aggregate_stats.items():
        if key == "all" or not stats.sample.values:
            continue
        p95 = percentile(stats.sample.values, 0.95)
        rows.append((p95 if p95 is not None else -1.0, key, stats.sample.values))
    rows.sort(reverse=True)

    written: list[str] = []
    for _, key, values in rows[:max_histograms]:
        fig, ax = plt.subplots(figsize=(8, 4.5))
        ax.hist(values, bins=50, color="#4C78A8", edgecolor="white")
        ax.set_title(key)
        ax.set_xlabel("reprojection error (px)")
        ax.set_ylabel("sample count")
        ax.grid(axis="y", alpha=0.25)
        fig.tight_layout()
        output_path = hist_dir / f"{key.replace('.', '__')}.png"
        fig.savefig(output_path, dpi=150)
        plt.close(fig)
        written.append(str(output_path))
    return written


def worst_rows(aggregate_stats: dict[str, RunningStats], limit: int = 30) -> list[dict[str, Any]]:
    rows = []
    for key, stats in aggregate_stats.items():
        if key == "all" or not stats.count:
            continue
        item = {"key": key, **stats_to_dict(stats)}
        rows.append(item)
    return sorted(
        rows,
        key=lambda row: (
            row.get("p95_px") if row.get("p95_px") is not None else -1.0,
            row.get("mean_px") if row.get("mean_px") is not None else -1.0,
        ),
        reverse=True,
    )[:limit]


def main() -> int:
    args = parse_args()
    random.seed(args.random_seed)
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    sequence_dirs = iter_sequence_dirs(args.input_root, args.sequence_glob)
    aggregate_stats = make_aggregate_stats(args.max_samples_per_bucket)

    worker_count = args.workers
    if worker_count == 0:
        worker_count = os.cpu_count() or 1
    worker_count = max(1, worker_count)
    if sys.platform == "win32":
        worker_count = min(worker_count, 61)
    cpu_count = os.cpu_count()
    if cpu_count:
        worker_count = min(worker_count, cpu_count)
    worker_count = min(worker_count, max(len(sequence_dirs), 1))

    if worker_count <= 1 or len(sequence_dirs) <= 1:
        sequences = [
            analyze_sequence(
                sequence_dir=sequence_dir,
                min_conf_2d=args.min_conf_2d,
                min_conf_3d=args.min_conf_3d,
                distortion_mode=args.distortion_mode,
                sample_limit=args.max_samples_per_bucket,
                aggregate_stats=aggregate_stats,
            )
            for sequence_dir in sequence_dirs
        ]
    else:
        sequences = []
        chunks = chunk_paths(sequence_dirs, worker_count)
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    analyze_sequence_batch,
                    chunk,
                    args.min_conf_2d,
                    args.min_conf_3d,
                    args.distortion_mode,
                    args.max_samples_per_bucket,
                    args.random_seed + index + 1,
                )
                for index, chunk in enumerate(chunks)
            ]
            completed = 0
            for future in as_completed(futures):
                result = future.result()
                sequences.extend(result["sequences"])
                merge_aggregate_stats(
                    aggregate_stats,
                    result["aggregate_stats"],
                    args.max_samples_per_bucket,
                )
                completed += 1
                print(
                    f"Completed worker chunks: {completed}/{len(futures)}",
                    flush=True,
                )
        sequences.sort(key=lambda item: item["sequence_id"])

    aggregate = {key: stats_to_dict(value) for key, value in sorted(aggregate_stats.items())}
    all_p95 = aggregate["all"]["p95_px"]
    verdict = {
        "status": "pass"
        if all_p95 is not None and all_p95 <= args.pass_p95_px
        else "fail",
        "thresholds": {"pass_p95_px": args.pass_p95_px},
        "reasons": []
        if all_p95 is not None and all_p95 <= args.pass_p95_px
        else [f"aggregate all p95_px {all_p95} > {args.pass_p95_px}"],
    }
    histogram_files = write_histograms(aggregate_stats, output_dir, args.max_histograms)

    report = {
        "config": {
            "input_root": str(args.input_root),
            "sequence_glob": args.sequence_glob,
            "min_conf_2d": args.min_conf_2d,
            "min_conf_3d": args.min_conf_3d,
            "distortion_mode": args.distortion_mode,
            "max_samples_per_bucket": args.max_samples_per_bucket,
            "pass_p95_px": args.pass_p95_px,
            "workers": worker_count,
            "keypoint_sets": KEYPOINT_SETS,
        },
        "summary": {
            "verdict": verdict,
            "sequence_count": len(sequences),
            "frame_count": sum(item["frame_count"] for item in sequences),
            "aggregate": aggregate,
            "worst_keys_by_p95": worst_rows(aggregate_stats),
            "histogram_count": len(histogram_files),
        },
        "sequences": sequences,
        "histogram_files": histogram_files,
    }

    report_path = output_dir / "reprojection_consistency_report.json"
    with report_path.open("w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=2)

    print(f"Scanned sequences: {len(sequences)}")
    print(f"Report: {report_path}")
    print(f"Verdict: {verdict['status']}")
    print(f"Aggregate p95 px: {all_p95}")
    print(f"Histograms: {output_dir / 'histograms'} ({len(histogram_files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
