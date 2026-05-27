#!/usr/bin/env python3
"""Create QA word JSON copies with smoothed image_2d keypoints.

The script does not modify source word JSON files. It writes copied words
named ``smooth2d_QA_full_*`` where ``sample.keypoints.image_2d`` contains the
smoothed data. Keep original 2D QA files separate as ``original2d_QA_full_*``.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

POSE_RIGHT_SHOULDER = 2
POSE_RIGHT_ELBOW = 3
POSE_RIGHT_WRIST = 4
POSE_LEFT_SHOULDER = 5
POSE_LEFT_ELBOW = 6
POSE_LEFT_WRIST = 7
POSE_NECK = 1

HAND_JOINT_COUNT = 21
HAND_PALM_INDICES = (0, 5, 9, 13, 17)
HAND_PARENT = {
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 0,
    6: 5,
    7: 6,
    8: 7,
    9: 0,
    10: 9,
    11: 10,
    12: 11,
    13: 0,
    14: 13,
    15: 14,
    16: 15,
    17: 0,
    18: 17,
    19: 18,
    20: 19,
}
UPPER_POSE_INDICES = (
    POSE_NECK,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_ELBOW,
    POSE_RIGHT_WRIST,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_ELBOW,
    POSE_LEFT_WRIST,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    default_root = Path(__file__).resolve().parents[2]
    parser.add_argument("--word-root", type=Path, default=default_root / "data" / "words")
    parser.add_argument(
        "--selection-json",
        type=Path,
        default=default_root / "hand_lifting" / "runs" / "viewer_qa_full" / "qa_no_source_3d_selection.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_root / "hand_lifting" / "runs" / "2d_smoothing_qa",
    )
    parser.add_argument("--output-prefix", default="smooth2d_QA_full")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--window-radius", type=int, default=3)
    parser.add_argument("--max-interpolate-run", type=int, default=3)
    parser.add_argument("--local-deviation-threshold", type=float, default=0.08)
    parser.add_argument("--motion-ratio-threshold", type=float, default=3.0)
    parser.add_argument("--bone-min-ratio", type=float, default=0.5)
    parser.add_argument("--bone-max-ratio", type=float, default=1.8)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.2)
    parser.add_argument("--write-copy", action="store_true")
    parser.add_argument("--markdown", action="store_true")
    parser.add_argument("--clean", action="store_true", help="Remove existing output-prefix JSON files first.")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def values_for(image_2d: dict[str, Any], part: str) -> list[Any]:
    values = ((image_2d or {}).get(part) or {}).get("values")
    return values if isinstance(values, list) else []


def shape_for(values: list[Any], point_count: int) -> dict[str, Any]:
    return {"shape": [len(values), point_count, 3], "values": values}


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def point_xy(point: Any) -> tuple[float, float] | None:
    if not isinstance(point, list) or len(point) < 2:
        return None
    x = finite_float(point[0], math.nan)
    y = finite_float(point[1], math.nan)
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return x, y


def confidence(point: Any) -> float:
    if not isinstance(point, list) or len(point) < 3:
        return 0.0
    return finite_float(point[2], 0.0)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def median_point(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not points:
        return None
    return median([point[0] for point in points]), median([point[1] for point in points])


def shoulder_width(pose_frames: list[Any]) -> float:
    widths: list[float] = []
    for frame in pose_frames:
        if not isinstance(frame, list):
            continue
        if len(frame) <= max(POSE_RIGHT_SHOULDER, POSE_LEFT_SHOULDER):
            continue
        right = point_xy(frame[POSE_RIGHT_SHOULDER])
        left = point_xy(frame[POSE_LEFT_SHOULDER])
        if right and left and confidence(frame[POSE_RIGHT_SHOULDER]) > 0.01 and confidence(frame[POSE_LEFT_SHOULDER]) > 0.01:
            widths.append(distance(right, left))
    return max(80.0, median(widths) if widths else 240.0)


def palm_center(frame: list[Any]) -> tuple[float, float] | None:
    points: list[tuple[float, float]] = []
    for index in HAND_PALM_INDICES:
        if index < len(frame) and confidence(frame[index]) > 0.01:
            xy = point_xy(frame[index])
            if xy:
                points.append(xy)
    return median_point(points)


def local_points(frames: list[Any], part: str) -> list[list[tuple[float, float] | None]]:
    local: list[list[tuple[float, float] | None]] = []
    for frame in frames:
        if not isinstance(frame, list):
            local.append([])
            continue
        if part == "pose":
            anchor = point_xy(frame[POSE_NECK]) if len(frame) > POSE_NECK else None
        else:
            anchor = palm_center(frame)
        if anchor is None:
            local.append([None for _ in frame])
            continue
        local_frame: list[tuple[float, float] | None] = []
        for point in frame:
            xy = point_xy(point)
            if xy is None or confidence(point) <= 0.01:
                local_frame.append(None)
            else:
                local_frame.append((xy[0] - anchor[0], xy[1] - anchor[1]))
        local.append(local_frame)
    return local


def median_bone_lengths(frames: list[Any]) -> dict[int, float]:
    lengths_by_joint: dict[int, list[float]] = {joint: [] for joint in HAND_PARENT}
    for frame in frames:
        if not isinstance(frame, list):
            continue
        for joint, parent in HAND_PARENT.items():
            if joint >= len(frame) or parent >= len(frame):
                continue
            child_xy = point_xy(frame[joint])
            parent_xy = point_xy(frame[parent])
            if not child_xy or not parent_xy:
                continue
            if confidence(frame[joint]) <= 0.01 or confidence(frame[parent]) <= 0.01:
                continue
            lengths_by_joint[joint].append(distance(child_xy, parent_xy))
    return {
        joint: median(lengths)
        for joint, lengths in lengths_by_joint.items()
        if lengths and median(lengths) > 1e-6
    }


def mark_window_outliers(
    frames: list[Any],
    part: str,
    args: argparse.Namespace,
    scale_px: float,
    pose_weak: bool,
) -> list[list[bool]]:
    frame_count = len(frames)
    max_points = max((len(frame) for frame in frames if isinstance(frame, list)), default=0)
    outliers = [[False for _ in range(max_points)] for _ in range(frame_count)]
    local = local_points(frames, part)
    threshold = max(8.0, args.local_deviation_threshold * scale_px * (2.0 if pose_weak else 1.0))
    absolute_motion_threshold = max(10.0, threshold * 0.8)
    candidate_indices = UPPER_POSE_INDICES if part == "pose" else tuple(range(max_points))

    for point_index in candidate_indices:
        if point_index >= max_points:
            continue
        for frame_index in range(frame_count):
            frame = frames[frame_index] if frame_index < len(frames) else []
            if not isinstance(frame, list) or point_index >= len(frame):
                continue
            point = frame[point_index]
            current_local = local[frame_index][point_index] if point_index < len(local[frame_index]) else None
            if current_local is None:
                continue
            window_points: list[tuple[float, float]] = []
            for other_index in range(
                max(0, frame_index - args.window_radius),
                min(frame_count, frame_index + args.window_radius + 1),
            ):
                other_local = local[other_index][point_index] if point_index < len(local[other_index]) else None
                other_frame = frames[other_index] if other_index < len(frames) else []
                if other_local is not None and isinstance(other_frame, list) and point_index < len(other_frame):
                    if confidence(other_frame[point_index]) > 0.01:
                        window_points.append(other_local)
            median_local = median_point(window_points)
            if median_local and distance(current_local, median_local) > threshold:
                outliers[frame_index][point_index] = True
            if confidence(point) < args.low_confidence_threshold and median_local and distance(current_local, median_local) > threshold * 0.5:
                outliers[frame_index][point_index] = True

        for frame_index in range(1, frame_count):
            frame = frames[frame_index]
            prev_frame = frames[frame_index - 1]
            if not isinstance(frame, list) or not isinstance(prev_frame, list):
                continue
            if point_index >= len(frame) or point_index >= len(prev_frame):
                continue
            xy = point_xy(frame[point_index])
            prev_xy = point_xy(prev_frame[point_index])
            if not xy or not prev_xy:
                continue
            joint_motion = distance(xy, prev_xy)
            if part == "pose":
                anchor_motion = 0.0
            else:
                anchor = palm_center(frame)
                prev_anchor = palm_center(prev_frame)
                anchor_motion = distance(anchor, prev_anchor) if anchor and prev_anchor else 0.0
            ratio = joint_motion / max(anchor_motion, 1.0)
            if joint_motion > absolute_motion_threshold and ratio > args.motion_ratio_threshold:
                outliers[frame_index][point_index] = True

    if part != "pose":
        median_lengths = median_bone_lengths(frames)
        for frame_index, frame in enumerate(frames):
            if not isinstance(frame, list):
                continue
            for joint, parent in HAND_PARENT.items():
                baseline = median_lengths.get(joint)
                if not baseline or joint >= len(frame) or parent >= len(frame):
                    continue
                child_xy = point_xy(frame[joint])
                parent_xy = point_xy(frame[parent])
                if not child_xy or not parent_xy:
                    continue
                ratio = distance(child_xy, parent_xy) / baseline
                if ratio < args.bone_min_ratio or ratio > args.bone_max_ratio:
                    outliers[frame_index][joint] = True
    return outliers


def find_runs(flags: list[bool]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        if not flag and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(flags) - 1))
    return runs


def interpolate_run(frames: list[Any], point_index: int, start: int, end: int) -> bool:
    prev_index = start - 1
    next_index = end + 1
    while prev_index >= 0:
        frame = frames[prev_index]
        if isinstance(frame, list) and point_index < len(frame) and point_xy(frame[point_index]):
            break
        prev_index -= 1
    while next_index < len(frames):
        frame = frames[next_index]
        if isinstance(frame, list) and point_index < len(frame) and point_xy(frame[point_index]):
            break
        next_index += 1
    if prev_index < 0 or next_index >= len(frames):
        return False
    prev_point = frames[prev_index][point_index]
    next_point = frames[next_index][point_index]
    prev_xy = point_xy(prev_point)
    next_xy = point_xy(next_point)
    if not prev_xy or not next_xy:
        return False
    span = next_index - prev_index
    for frame_index in range(start, end + 1):
        alpha = (frame_index - prev_index) / span
        frame = frames[frame_index]
        if not isinstance(frame, list) or point_index >= len(frame):
            continue
        frame[point_index][0] = round(prev_xy[0] * (1.0 - alpha) + next_xy[0] * alpha, 6)
        frame[point_index][1] = round(prev_xy[1] * (1.0 - alpha) + next_xy[1] * alpha, 6)
    return True


def apply_outlier_interpolation(
    frames: list[Any],
    outliers: list[list[bool]],
    args: argparse.Namespace,
) -> tuple[int, int, list[dict[str, Any]]]:
    corrected = 0
    long_runs = 0
    run_records: list[dict[str, Any]] = []
    max_points = max((len(frame) for frame in frames if isinstance(frame, list)), default=0)
    for point_index in range(max_points):
        flags = [frame_flags[point_index] if point_index < len(frame_flags) else False for frame_flags in outliers]
        for start, end in find_runs(flags):
            run_length = end - start + 1
            if run_length <= args.max_interpolate_run and interpolate_run(frames, point_index, start, end):
                corrected += run_length
            else:
                long_runs += 1
                run_records.append({"joint": point_index, "start_frame": start, "end_frame": end, "length": run_length})
    return corrected, long_runs, run_records


def smooth_part(
    frames: list[Any],
    part: str,
    args: argparse.Namespace,
    scale_px: float,
    pose_weak: bool = False,
) -> tuple[list[Any], dict[str, Any]]:
    smoothed = copy.deepcopy(frames)
    outliers = mark_window_outliers(smoothed, part, args, scale_px, pose_weak)
    detected = sum(1 for frame_flags in outliers for flag in frame_flags if flag)
    corrected, long_runs, run_records = apply_outlier_interpolation(smoothed, outliers, args)
    return smoothed, {
        "detected_outlier_points": detected,
        "corrected_points": corrected,
        "long_run_count": long_runs,
        "long_runs": run_records[:30],
    }


def selected_words(selection_json: Path) -> list[str]:
    payload = load_json(selection_json)
    words = payload.get("selected_words")
    if not isinstance(words, list) or not words:
        raise ValueError(f"selection_json does not contain selected_words: {selection_json}")
    return [str(word) for word in words]


def process_word(task: tuple[int, str, dict[str, Any]]) -> dict[str, Any]:
    index, word, raw_args = task
    args = argparse.Namespace(**raw_args)
    source_path = args.word_root / f"{word}.json"
    if not source_path.exists():
        return {"word": word, "status": "failed", "reason": "source_missing"}

    payload = load_json(source_path)
    sample = payload.get("sample") or {}
    keypoints = sample.get("keypoints") or {}
    image_2d = keypoints.get("image_2d") or {}
    pose_frames = values_for(image_2d, "pose")
    left_frames = values_for(image_2d, "left_hand")
    right_frames = values_for(image_2d, "right_hand")
    scale_px = shoulder_width(pose_frames)

    pose_smoothed, pose_stats = smooth_part(pose_frames, "pose", args, scale_px, pose_weak=True)
    left_smoothed, left_stats = smooth_part(left_frames, "left_hand", args, scale_px, pose_weak=False)
    right_smoothed, right_stats = smooth_part(right_frames, "right_hand", args, scale_px, pose_weak=False)

    output = copy.deepcopy(payload)
    output["word"] = f"{args.output_prefix}_{index:02d}_{word}"
    output_sample = output.setdefault("sample", {})
    output_keypoints = output_sample.setdefault("keypoints", {})
    output_keypoints.pop("image_2d_original", None)
    output_image_2d = copy.deepcopy(image_2d)
    output_image_2d["pose"] = shape_for(pose_smoothed, 25)
    output_image_2d["left_hand"] = shape_for(left_smoothed, HAND_JOINT_COUNT)
    output_image_2d["right_hand"] = shape_for(right_smoothed, HAND_JOINT_COUNT)
    output_keypoints["image_2d"] = output_image_2d
    output_sample.setdefault("processing", {})["image_2d_smoothing_method"] = "hand_lifting_2d_outlier_smoothing_v1"
    output["viewer_qa_alias"] = {
        "source_word": word,
        "source_file": source_path.name,
        "qa_kind": args.output_prefix,
    }
    output_path = args.word_root / f"{output['word']}.json"
    if args.write_copy:
        write_json(output_path, output)

    return {
        "word": word,
        "output_word": output["word"],
        "output": str(output_path),
        "status": "written" if args.write_copy else "dry_run",
        "frame_count": max(len(pose_frames), len(left_frames), len(right_frames)),
        "shoulder_width_px": round(scale_px, 6),
        "stats": {
            "pose": pose_stats,
            "left_hand": left_stats,
            "right_hand": right_stats,
        },
    }


def write_markdown(summary: dict[str, Any], path: Path) -> None:
    lines = [
        "# 2D Outlier Smoothing Summary",
        "",
        f"- created_at: `{summary['created_at']}`",
        f"- selected_count: `{summary['selected_count']}`",
        f"- written_count: `{summary['written_count']}`",
        f"- failed_count: `{summary['failed_count']}`",
        "",
        "## Top Corrected Words",
        "",
        "| word | frames | corrected | detected | long runs |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    rows = sorted(
        summary["results"],
        key=lambda item: item.get("total_corrected_points", 0),
        reverse=True,
    )
    for item in rows[:30]:
        lines.append(
            f"| {item.get('word')} | {item.get('frame_count', 0)} | "
            f"{item.get('total_corrected_points', 0)} | {item.get('total_detected_outlier_points', 0)} | "
            f"{item.get('total_long_run_count', 0)} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    args.word_root = args.word_root.resolve()
    args.selection_json = args.selection_json.resolve()
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.clean:
        for path in args.word_root.glob(f"{args.output_prefix}_*.json"):
            path.unlink()

    words = selected_words(args.selection_json)
    raw_args = {
        "word_root": args.word_root,
        "output_prefix": args.output_prefix,
        "write_copy": args.write_copy,
        "window_radius": args.window_radius,
        "max_interpolate_run": args.max_interpolate_run,
        "local_deviation_threshold": args.local_deviation_threshold,
        "motion_ratio_threshold": args.motion_ratio_threshold,
        "bone_min_ratio": args.bone_min_ratio,
        "bone_max_ratio": args.bone_max_ratio,
        "low_confidence_threshold": args.low_confidence_threshold,
    }
    tasks = [(index, word, raw_args) for index, word in enumerate(words)]
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            results = list(executor.map(process_word, tasks))
    else:
        results = [process_word(task) for task in tasks]

    for result in results:
        stats = result.get("stats") or {}
        result["total_detected_outlier_points"] = sum(
            int((stats.get(part) or {}).get("detected_outlier_points", 0))
            for part in ("pose", "left_hand", "right_hand")
        )
        result["total_corrected_points"] = sum(
            int((stats.get(part) or {}).get("corrected_points", 0))
            for part in ("pose", "left_hand", "right_hand")
        )
        result["total_long_run_count"] = sum(
            int((stats.get(part) or {}).get("long_run_count", 0))
            for part in ("pose", "left_hand", "right_hand")
        )

    summary = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "word_root": str(args.word_root),
        "selection_json": str(args.selection_json),
        "output_prefix": args.output_prefix,
        "selected_count": len(words),
        "written_count": sum(1 for result in results if result.get("status") == "written"),
        "failed_count": sum(1 for result in results if result.get("status") == "failed"),
        "config": {
            "window_radius": args.window_radius,
            "max_interpolate_run": args.max_interpolate_run,
            "local_deviation_threshold": args.local_deviation_threshold,
            "motion_ratio_threshold": args.motion_ratio_threshold,
            "bone_min_ratio": args.bone_min_ratio,
            "bone_max_ratio": args.bone_max_ratio,
            "low_confidence_threshold": args.low_confidence_threshold,
        },
        "results": results,
    }
    report_path = args.output_dir / "2d_outlier_smoothing_report.json"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.markdown:
        write_markdown(summary, args.output_dir / "2d_outlier_smoothing_summary.md")

    print(
        json.dumps(
            {
                "selected_count": summary["selected_count"],
                "written_count": summary["written_count"],
                "failed_count": summary["failed_count"],
                "report": str(report_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if summary["failed_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
