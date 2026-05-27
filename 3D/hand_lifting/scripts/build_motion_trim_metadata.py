#!/usr/bin/env python3
"""Build trim ranges for sign keypoint sequences.

The script writes metadata only. It does not copy or modify keypoint JSON files.
Trim ranges can be sourced from morpheme timing labels, a wrist/hand motion
heuristic, or morpheme labels with motion fallback.

Examples:
    python scripts/build_motion_trim_metadata.py \
        --keypoint-root "D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_word_keypoint/01" \
        --morpheme-root "D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_word_morpheme/morpheme/01" \
        --output artifacts/trim_word_train_F.json \
        --sequence-glob "*_F"

    python scripts/build_motion_trim_metadata.py \
        --keypoint-root "D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_sen_keypoint/01" \
        --morpheme-root "D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_sen_morpheme/morpheme/01" \
        --output artifacts/trim_sen_train_F.json \
        --sequence-glob "*_F"
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from statistics import mean, median, pstdev
from typing import Any


FRAME_RE = re.compile(r"_(\d+)_keypoints\.json$", re.IGNORECASE)

POSE_RIGHT_WRIST = 4
POSE_LEFT_WRIST = 7
POSE_RIGHT_SHOULDER = 2
POSE_LEFT_SHOULDER = 5
HAND_WRIST = 0
HAND_PALM_INDICES = (0, 5, 9, 13, 17)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keypoint-root",
        required=True,
        type=Path,
        help="Directory containing sequence folders such as NIA_SL_WORD0001_REAL01_F.",
    )
    parser.add_argument(
        "--morpheme-root",
        type=Path,
        help="Directory containing *_morpheme.json files. Optional for motion-only.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Output trim metadata JSON path.",
    )
    parser.add_argument(
        "--jsonl-output",
        type=Path,
        help="Optional JSONL output with one trim row per sequence.",
    )
    parser.add_argument(
        "--sequence-glob",
        default="*_F",
        help="Glob for selecting sequence directories. Default: *_F.",
    )
    parser.add_argument(
        "--source",
        default="auto",
        choices=("auto", "morpheme", "motion"),
        help=(
            "Trim source. auto uses morpheme timing when available and motion "
            "fallback otherwise. Default: auto."
        ),
    )
    parser.add_argument(
        "--padding-frames",
        default=7,
        type=int,
        help="Frames to keep before/after detected trim range. Default: 7.",
    )
    parser.add_argument(
        "--min-trim-frames",
        default=16,
        type=int,
        help="Minimum output segment length. Short ranges are expanded. Default: 16.",
    )
    parser.add_argument(
        "--smooth-window",
        default=5,
        type=int,
        help="Odd moving-average window for motion speed. Default: 5.",
    )
    parser.add_argument(
        "--threshold-peak-ratio",
        default=0.22,
        type=float,
        help="Motion threshold lower bound as a ratio of peak speed. Default: 0.22.",
    )
    parser.add_argument(
        "--threshold-std-factor",
        default=0.75,
        type=float,
        help="Motion threshold lower bound as median + factor * std. Default: 0.75.",
    )
    parser.add_argument(
        "--gap-fill",
        default=2,
        type=int,
        help="Fill inactive gaps up to this many frames. Default: 2.",
    )
    parser.add_argument(
        "--min-active-run",
        default=3,
        type=int,
        help="Remove active runs shorter than this many frames. Default: 3.",
    )
    parser.add_argument(
        "--include-motion-diagnostics",
        action="store_true",
        help=(
            "Compute and store motion heuristic details even when morpheme "
            "timing is available. Slower, useful for QA only."
        ),
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


def frame_index_from_path(path: Path) -> int:
    match = FRAME_RE.search(path.name)
    if not match:
        return -1
    return int(match.group(1))


def iter_sequence_dirs(keypoint_root: Path, sequence_glob: str) -> list[Path]:
    if not keypoint_root.exists():
        raise FileNotFoundError(f"Keypoint root does not exist: {keypoint_root}")
    return sorted(path for path in keypoint_root.glob(sequence_glob) if path.is_dir())


def iter_frame_files(sequence_dir: Path) -> list[Path]:
    return sorted(
        sequence_dir.glob("*_keypoints.json"),
        key=lambda path: (frame_index_from_path(path), path.name),
    )


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def get_people(payload: dict[str, Any]) -> dict[str, Any] | None:
    people = payload.get("people")
    if isinstance(people, dict):
        return people
    if isinstance(people, list) and people and isinstance(people[0], dict):
        return people[0]
    return None


def parse_2d_point(raw: Any, idx: int, stride: int = 3, min_conf: float = 0.0) -> tuple[float, float] | None:
    if not isinstance(raw, list) or len(raw) < (idx + 1) * stride:
        return None
    offset = idx * stride
    try:
        x = float(raw[offset])
        y = float(raw[offset + 1])
        conf = float(raw[offset + 2])
    except (TypeError, ValueError):
        return None
    if conf <= min_conf or not all(math.isfinite(value) for value in (x, y)):
        return None
    if abs(x) < 1e-12 and abs(y) < 1e-12:
        return None
    return (x, y)


def average_points(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not points:
        return None
    return (sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points))


def blend_points(weighted_points: list[tuple[float, tuple[float, float] | None]]) -> tuple[float, float] | None:
    valid = [(weight, point) for weight, point in weighted_points if point is not None and weight > 0.0]
    weight_sum = sum(weight for weight, _ in valid)
    if weight_sum <= 0.0:
        return None
    return (
        sum(weight * point[0] for weight, point in valid) / weight_sum,
        sum(weight * point[1] for weight, point in valid) / weight_sum,
    )


def shoulder_width_2d(pose: Any) -> float | None:
    left = parse_2d_point(pose, POSE_LEFT_SHOULDER)
    right = parse_2d_point(pose, POSE_RIGHT_SHOULDER)
    if left is None or right is None:
        return None
    width = math.dist(left, right)
    return width if width > 1e-6 else None


def hand_palm_center(hand: Any) -> tuple[float, float] | None:
    points = [
        point
        for idx in HAND_PALM_INDICES
        if (point := parse_2d_point(hand, idx)) is not None
    ]
    return average_points(points)


def hand_motion_point(
    pose: Any, hand: Any, pose_wrist_idx: int
) -> tuple[float, float] | None:
    pose_wrist = parse_2d_point(pose, pose_wrist_idx)
    hand_wrist = parse_2d_point(hand, HAND_WRIST)
    palm = hand_palm_center(hand)
    return blend_points(
        [
            (0.30, pose_wrist),
            (0.35, hand_wrist),
            (0.35, palm),
        ]
    )


def moving_average(values: list[float], window: int) -> list[float]:
    if not values:
        return []
    window = max(1, window)
    if window % 2 == 0:
        window += 1
    pad = window // 2
    output: list[float] = []
    for index in range(len(values)):
        start = max(0, index - pad)
        end = min(len(values), index + pad + 1)
        output.append(sum(values[start:end]) / (end - start))
    return output


def fill_small_gaps(mask: list[bool], gap: int) -> list[bool]:
    output = mask[:]
    index = 0
    while index < len(output):
        if output[index]:
            index += 1
            continue
        end = index
        while end < len(output) and not output[end]:
            end += 1
        if index > 0 and end < len(output) and (end - index) <= gap:
            output[index:end] = [True] * (end - index)
        index = end
    return output


def trim_short_runs(mask: list[bool], min_len: int) -> list[bool]:
    output = mask[:]
    index = 0
    while index < len(output):
        if not output[index]:
            index += 1
            continue
        end = index
        while end < len(output) and output[end]:
            end += 1
        if (end - index) < min_len:
            output[index:end] = [False] * (end - index)
        index = end
    return output


def largest_run(mask: list[bool]) -> tuple[int, int] | None:
    best: tuple[int, int] | None = None
    index = 0
    while index < len(mask):
        if not mask[index]:
            index += 1
            continue
        end = index
        while end < len(mask) and mask[end]:
            end += 1
        candidate = (index, end - 1)
        if best is None or (candidate[1] - candidate[0]) > (best[1] - best[0]):
            best = candidate
        index = end
    return best


def expand_range(start: int, end: int, frame_count: int, min_frames: int) -> tuple[int, int]:
    start = max(0, min(start, frame_count - 1))
    end = max(0, min(end, frame_count - 1))
    if end < start:
        start, end = end, start

    current = end - start + 1
    if current >= min_frames:
        return start, end

    needed = min_frames - current
    left = needed // 2
    right = needed - left
    start = max(0, start - left)
    end = min(frame_count - 1, end + right)

    current = end - start + 1
    if current < min_frames:
        if start == 0:
            end = min(frame_count - 1, start + min_frames - 1)
        elif end == frame_count - 1:
            start = max(0, end - min_frames + 1)
    return start, end


def apply_padding(start: int, end: int, frame_count: int, padding: int, min_frames: int) -> tuple[int, int]:
    return expand_range(start - padding, end + padding, frame_count, min_frames)


def motion_trim(
    frame_files: list[Path],
    smooth_window: int,
    threshold_peak_ratio: float,
    threshold_std_factor: float,
    gap_fill: int,
    min_active_run: int,
) -> dict[str, Any]:
    left_points: list[tuple[float, float] | None] = []
    right_points: list[tuple[float, float] | None] = []
    scales: list[float | None] = []
    invalid_frames = 0

    for frame_file in frame_files:
        payload = load_json(frame_file)
        people = get_people(payload) if payload is not None else None
        if people is None:
            invalid_frames += 1
            left_points.append(None)
            right_points.append(None)
            scales.append(None)
            continue

        pose = people.get("pose_keypoints_2d")
        left_hand = people.get("hand_left_keypoints_2d")
        right_hand = people.get("hand_right_keypoints_2d")
        left_points.append(hand_motion_point(pose, left_hand, POSE_LEFT_WRIST))
        right_points.append(hand_motion_point(pose, right_hand, POSE_RIGHT_WRIST))
        scales.append(shoulder_width_2d(pose))

    scale_values = [value for value in scales if value is not None and value > 1e-6]
    fallback_scale = median(scale_values) if scale_values else 1.0

    def speed_series(points: list[tuple[float, float] | None]) -> list[float]:
        speeds = [0.0]
        for index in range(1, len(points)):
            prev = points[index - 1]
            curr = points[index]
            scale = scales[index] or fallback_scale
            if prev is None or curr is None or scale <= 1e-6:
                speeds.append(0.0)
            else:
                speeds.append(math.dist(prev, curr) / scale)
        return moving_average(speeds, smooth_window)

    left_speed = speed_series(left_points)
    right_speed = speed_series(right_points)
    left_sum = sum(left_speed)
    right_sum = sum(right_speed)
    dominant_hand = "left" if left_sum >= right_sum else "right"
    speed = [max(left, right) for left, right in zip(left_speed, right_speed)]

    if not speed:
        return {
            "start": 0,
            "end": 0,
            "dominant_hand": dominant_hand,
            "peak_speed": 0.0,
            "speed_median": 0.0,
            "speed_std": 0.0,
            "threshold": 0.0,
            "invalid_frame_count": invalid_frames,
            "fallback": "empty_sequence",
        }

    peak = max(speed)
    med = median(speed)
    std = pstdev(speed) if len(speed) > 1 else 0.0
    threshold = max(med + threshold_std_factor * std, peak * threshold_peak_ratio)
    active = [value >= threshold and value > 0.0 for value in speed]
    active = fill_small_gaps(active, gap_fill)
    active = trim_short_runs(active, min_active_run)
    run = largest_run(active)

    fallback = None
    if run is None:
        center = max(range(len(speed)), key=lambda idx: speed[idx])
        run = (center, center)
        fallback = "peak_frame"

    return {
        "start": int(run[0]),
        "end": int(run[1]),
        "dominant_hand": dominant_hand,
        "peak_speed": round(peak, 8),
        "speed_median": round(med, 8),
        "speed_std": round(std, 8),
        "threshold": round(threshold, 8),
        "invalid_frame_count": invalid_frames,
        "fallback": fallback,
    }


def morpheme_path_for(morpheme_root: Path, sequence_id: str) -> Path:
    return morpheme_root / f"{sequence_id}_morpheme.json"


def morpheme_trim(
    morpheme_root: Path | None, sequence_id: str, frame_count: int
) -> dict[str, Any] | None:
    if morpheme_root is None:
        return None
    path = morpheme_path_for(morpheme_root, sequence_id)
    payload = load_json(path)
    if payload is None:
        return None

    duration = float(payload.get("metaData", {}).get("duration", 0.0) or 0.0)
    segments = payload.get("data")
    if duration <= 0.0 or not isinstance(segments, list) or not segments:
        return None

    starts: list[float] = []
    ends: list[float] = []
    labels: list[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        try:
            start = float(segment.get("start"))
            end = float(segment.get("end"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(start) or not math.isfinite(end):
            continue
        starts.append(max(0.0, min(start, duration)))
        ends.append(max(0.0, min(end, duration)))
        attrs = segment.get("attributes")
        if isinstance(attrs, list) and attrs and isinstance(attrs[0], dict):
            label = attrs[0].get("name")
            if isinstance(label, str):
                labels.append(label)

    if not starts or not ends:
        return None

    start_sec = min(starts)
    end_sec = max(ends)
    start_frame = round(start_sec / duration * (frame_count - 1))
    end_frame = round(end_sec / duration * (frame_count - 1))
    return {
        "start": int(start_frame),
        "end": int(end_frame),
        "morpheme_path": str(path),
        "duration_sec": duration,
        "segment_count": len(starts),
        "start_sec": round(start_sec, 6),
        "end_sec": round(end_sec, 6),
        "labels_preview": labels[:10],
    }


def choose_trim(
    sequence_dir: Path,
    morpheme_root: Path | None,
    source: str,
    padding_frames: int,
    min_trim_frames: int,
    smooth_window: int,
    threshold_peak_ratio: float,
    threshold_std_factor: float,
    gap_fill: int,
    min_active_run: int,
    include_motion_diagnostics: bool,
) -> dict[str, Any] | None:
    frame_files = iter_frame_files(sequence_dir)
    frame_count = len(frame_files)
    if frame_count <= 0:
        return None

    sequence_id = sequence_dir.name
    morph = morpheme_trim(morpheme_root, sequence_id, frame_count)
    motion: dict[str, Any] | None = None
    needs_motion = source == "motion" or morph is None or include_motion_diagnostics
    if needs_motion:
        motion = motion_trim(
            frame_files=frame_files,
            smooth_window=smooth_window,
            threshold_peak_ratio=threshold_peak_ratio,
            threshold_std_factor=threshold_std_factor,
            gap_fill=gap_fill,
            min_active_run=min_active_run,
        )

    selected_source = source
    selected: dict[str, Any] | None
    if source == "morpheme":
        selected = morph
    elif source == "motion":
        selected = motion
    else:
        selected = morph if morph is not None else motion
        selected_source = "morpheme" if morph is not None else "motion"

    if selected is None:
        if motion is None:
            motion = motion_trim(
                frame_files=frame_files,
                smooth_window=smooth_window,
                threshold_peak_ratio=threshold_peak_ratio,
                threshold_std_factor=threshold_std_factor,
                gap_fill=gap_fill,
                min_active_run=min_active_run,
            )
        selected = motion
        selected_source = "motion-fallback"

    start, end = apply_padding(
        int(selected["start"]),
        int(selected["end"]),
        frame_count,
        padding_frames,
        min_trim_frames,
    )

    row = {
        "sequence_id": sequence_id,
        "sequence_dir": str(sequence_dir),
        "frame_count": frame_count,
        "trim_start_frame": int(start),
        "trim_end_frame": int(end),
        "trim_frame_count": int(end - start + 1),
        "trim_ratio": round((end - start + 1) / frame_count, 6),
        "padding_frames": padding_frames,
        "min_trim_frames": min_trim_frames,
        "source": selected_source,
        "motion": motion,
        "morpheme": morph,
    }
    return row


def choose_trim_batch(
    sequence_dirs: list[Path],
    morpheme_root: Path | None,
    source: str,
    padding_frames: int,
    min_trim_frames: int,
    smooth_window: int,
    threshold_peak_ratio: float,
    threshold_std_factor: float,
    gap_fill: int,
    min_active_run: int,
    include_motion_diagnostics: bool,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    skipped_count = 0
    for sequence_dir in sequence_dirs:
        row = choose_trim(
            sequence_dir=sequence_dir,
            morpheme_root=morpheme_root,
            source=source,
            padding_frames=padding_frames,
            min_trim_frames=min_trim_frames,
            smooth_window=smooth_window,
            threshold_peak_ratio=threshold_peak_ratio,
            threshold_std_factor=threshold_std_factor,
            gap_fill=gap_fill,
            min_active_run=min_active_run,
            include_motion_diagnostics=include_motion_diagnostics,
        )
        if row is None:
            skipped_count += 1
        else:
            rows.append(row)
    return {"rows": rows, "skipped_count": skipped_count}


def chunk_paths(paths: list[Path], worker_count: int) -> list[list[Path]]:
    chunks = [[] for _ in range(worker_count)]
    for index, path in enumerate(paths):
        chunks[index % worker_count].append(path)
    return [chunk for chunk in chunks if chunk]


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


def summarize(rows: list[dict[str, Any]], skipped_count: int) -> dict[str, Any]:
    source_counts = Counter(row["source"] for row in rows)
    frame_counts = [row["frame_count"] for row in rows]
    trim_counts = [row["trim_frame_count"] for row in rows]
    trim_ratios = [row["trim_ratio"] for row in rows]

    def stats(values: list[int | float]) -> dict[str, float | int | None]:
        if not values:
            return {"min": None, "max": None, "mean": None, "median": None}
        return {
            "min": min(values),
            "max": max(values),
            "mean": round(mean(values), 6),
            "median": round(median(values), 6),
        }

    return {
        "sequence_count": len(rows),
        "skipped_count": skipped_count,
        "source_counts": dict(sorted(source_counts.items())),
        "frame_count": stats(frame_counts),
        "trim_frame_count": stats(trim_counts),
        "trim_ratio": stats(trim_ratios),
    }


def main() -> int:
    args = parse_args()
    sequence_dirs = iter_sequence_dirs(args.keypoint_root, args.sequence_glob)

    rows: list[dict[str, Any]] = []
    skipped_count = 0
    worker_count = resolve_worker_count(args.workers, len(sequence_dirs))
    if worker_count <= 1 or len(sequence_dirs) <= 1:
        result = choose_trim_batch(
            sequence_dirs=sequence_dirs,
            morpheme_root=args.morpheme_root,
            source=args.source,
            padding_frames=args.padding_frames,
            min_trim_frames=args.min_trim_frames,
            smooth_window=args.smooth_window,
            threshold_peak_ratio=args.threshold_peak_ratio,
            threshold_std_factor=args.threshold_std_factor,
            gap_fill=args.gap_fill,
            min_active_run=args.min_active_run,
            include_motion_diagnostics=args.include_motion_diagnostics,
        )
        rows = result["rows"]
        skipped_count = int(result["skipped_count"])
    else:
        chunks = chunk_paths(sequence_dirs, worker_count)
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    choose_trim_batch,
                    chunk,
                    args.morpheme_root,
                    args.source,
                    args.padding_frames,
                    args.min_trim_frames,
                    args.smooth_window,
                    args.threshold_peak_ratio,
                    args.threshold_std_factor,
                    args.gap_fill,
                    args.min_active_run,
                    args.include_motion_diagnostics,
                )
                for chunk in chunks
            ]
            completed = 0
            for future in as_completed(futures):
                result = future.result()
                rows.extend(result["rows"])
                skipped_count += int(result["skipped_count"])
                completed += 1
                print(f"Completed worker chunks: {completed}/{len(futures)}", flush=True)
        rows.sort(key=lambda row: row["sequence_id"])

    report = {
        "config": {
            "keypoint_root": str(args.keypoint_root),
            "morpheme_root": str(args.morpheme_root) if args.morpheme_root else None,
            "sequence_glob": args.sequence_glob,
            "source": args.source,
            "padding_frames": args.padding_frames,
            "min_trim_frames": args.min_trim_frames,
            "smooth_window": args.smooth_window,
            "threshold_peak_ratio": args.threshold_peak_ratio,
            "threshold_std_factor": args.threshold_std_factor,
            "gap_fill": args.gap_fill,
            "min_active_run": args.min_active_run,
            "include_motion_diagnostics": args.include_motion_diagnostics,
            "workers": worker_count,
        },
        "summary": summarize(rows, skipped_count),
        "trims": {row["sequence_id"]: row for row in rows},
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.jsonl_output:
        args.jsonl_output.parent.mkdir(parents=True, exist_ok=True)
        with args.jsonl_output.open("w", encoding="utf-8") as fp:
            for row in rows:
                fp.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"Sequences: {len(rows)}")
    print(f"Skipped: {skipped_count}")
    print(f"Output: {args.output}")
    if args.jsonl_output:
        print(f"JSONL: {args.jsonl_output}")
    print(f"Source counts: {report['summary']['source_counts']}")
    print(f"Trim ratio: {report['summary']['trim_ratio']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
