#!/usr/bin/env python3
"""Create corrected 2D hand-keypoint QA copies and preprocessing reports.

The script never overwrites source word JSON files. It writes copied word JSON
files with a new prefix and replaces only ``sample.keypoints.image_2d`` hand
coordinates with joint-wise corrected values.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_WORD_ROOT = THREE_D_ROOT / "data" / "words"
DEFAULT_SELECTION_JSON = (
    THREE_D_ROOT
    / "hand_lifting"
    / "runs"
    / "viewer_qa_full"
    / "qa_no_source_3d_selection.json"
)
DEFAULT_OUTPUT_DIR = THREE_D_ROOT / "hand_lifting" / "runs" / "2d_preprocess_v2"

sys.path.insert(0, str(SCRIPT_DIR))

from correct_finger_jitter_2d import (  # noqa: E402
    FingerJitterConfig,
    correct_finger_jitter_2d,
)

POSE_NECK = 1
POSE_RIGHT_SHOULDER = 2
POSE_RIGHT_ELBOW = 3
POSE_RIGHT_WRIST = 4
POSE_LEFT_SHOULDER = 5
POSE_LEFT_ELBOW = 6
POSE_LEFT_WRIST = 7
POSE_MID_HIP = 8
POSE_RIGHT_HIP = 9
POSE_LEFT_HIP = 12
UPPER_BODY_POSE_INDICES = (
    POSE_NECK,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_ELBOW,
    POSE_RIGHT_WRIST,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_ELBOW,
    POSE_LEFT_WRIST,
    POSE_MID_HIP,
    POSE_RIGHT_HIP,
    POSE_LEFT_HIP,
)
TORSO_LOCAL_POSE_INDICES = (
    POSE_NECK,
    POSE_RIGHT_SHOULDER,
    POSE_LEFT_SHOULDER,
    POSE_MID_HIP,
    POSE_RIGHT_HIP,
    POSE_LEFT_HIP,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", type=Path, default=DEFAULT_WORD_ROOT)
    parser.add_argument("--selection-json", type=Path, default=DEFAULT_SELECTION_JSON)
    parser.add_argument("--include-pattern", default="*.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--output-prefix", default="smooth2d_v2_QA_full")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--write-copy", action="store_true")
    parser.add_argument("--markdown", action="store_true")
    parser.add_argument("--clean", action="store_true", help="Remove existing output-prefix JSON files from word-root first.")
    parser.add_argument("--low-confidence-threshold", type=float, default=0.2)
    parser.add_argument("--motion-ratio-threshold", type=float, default=3.0)
    parser.add_argument("--local-deviation-threshold", type=float, default=0.08)
    parser.add_argument("--window-radius", type=int, default=3)
    parser.add_argument("--max-interpolate-run", type=int, default=3)
    parser.add_argument("--bone-min-ratio", type=float, default=0.5)
    parser.add_argument("--bone-max-ratio", type=float, default=1.8)
    parser.add_argument("--tip-strictness", type=float, default=1.25)
    parser.add_argument("--mcp-strictness", type=float, default=0.75)
    parser.add_argument("--pip-min-angle-deg", type=float, default=25.0)
    parser.add_argument("--dip-min-angle-deg", type=float, default=20.0)
    parser.add_argument("--mcp-min-angle-deg", type=float, default=18.0)
    parser.add_argument("--cross-hand-proximity-threshold", type=float, default=0.13)
    parser.add_argument("--smooth-pose", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--pose-local-deviation-threshold", type=float, default=0.05)
    parser.add_argument("--pose-blend-alpha", type=float, default=0.35)
    parser.add_argument("--smooth-body-translation", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--body-translation-max-px", type=float, default=10.0)
    parser.add_argument("--body-translation-alpha", type=float, default=0.75)
    parser.add_argument("--smooth-torso-local", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--torso-local-alpha", type=float, default=0.85)
    parser.add_argument("--torso-local-max-delta-px", type=float, default=12.0)
    parser.add_argument("--top-frame-limit", type=int, default=300)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def values_for(image_2d: dict[str, Any], part: str) -> list[Any]:
    values = ((image_2d or {}).get(part) or {}).get("values")
    return values if isinstance(values, list) else []


def shape_block(values: list[Any], point_count: int) -> dict[str, Any]:
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


def pose_anchor(frame: Any) -> tuple[float, float] | None:
    if not isinstance(frame, list):
        return None
    points: list[tuple[float, float]] = []
    for index in (POSE_NECK, POSE_RIGHT_SHOULDER, POSE_LEFT_SHOULDER, POSE_MID_HIP):
        if index < len(frame) and confidence(frame[index]) > 0.01:
            xy = point_xy(frame[index])
            if xy:
                points.append(xy)
    return median_point(points)


def shoulder_width_px(pose_frames: list[Any], minimum: float = 80.0) -> float:
    widths: list[float] = []
    for frame in pose_frames:
        if not isinstance(frame, list) or len(frame) <= max(POSE_RIGHT_SHOULDER, POSE_LEFT_SHOULDER):
            continue
        right = point_xy(frame[POSE_RIGHT_SHOULDER])
        left = point_xy(frame[POSE_LEFT_SHOULDER])
        if right and left and confidence(frame[POSE_RIGHT_SHOULDER]) > 0.01 and confidence(frame[POSE_LEFT_SHOULDER]) > 0.01:
            widths.append(distance(right, left))
    return max(minimum, median(widths) if widths else 240.0)


def local_pose_points(pose_frames: list[Any]) -> list[list[tuple[float, float] | None]]:
    local: list[list[tuple[float, float] | None]] = []
    for frame in pose_frames:
        if not isinstance(frame, list):
            local.append([])
            continue
        anchor = pose_anchor(frame)
        local_frame: list[tuple[float, float] | None] = []
        for point in frame:
            xy = point_xy(point)
            if xy is None or anchor is None or confidence(point) <= 0.01:
                local_frame.append(None)
            else:
                local_frame.append((xy[0] - anchor[0], xy[1] - anchor[1]))
        local.append(local_frame)
    return local


def window_median_local(
    local_frames: list[list[tuple[float, float] | None]],
    pose_frames: list[Any],
    joint: int,
    frame_index: int,
    radius: int,
) -> tuple[float, float] | None:
    points: list[tuple[float, float]] = []
    for other_index in range(max(0, frame_index - radius), min(len(local_frames), frame_index + radius + 1)):
        if other_index == frame_index:
            continue
        frame = pose_frames[other_index]
        point = local_frames[other_index][joint] if joint < len(local_frames[other_index]) else None
        if point is not None and isinstance(frame, list) and joint < len(frame) and confidence(frame[joint]) > 0.01:
            points.append(point)
    return median_point(points)


def find_runs(flags: list[bool]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(flags) - 1))
    return runs


def interpolate_pose_run(frames: list[Any], joint: int, start: int, end: int) -> int:
    prev_index = start - 1
    next_index = end + 1
    while prev_index >= 0:
        frame = frames[prev_index]
        if isinstance(frame, list) and joint < len(frame) and point_xy(frame[joint]) is not None:
            break
        prev_index -= 1
    while next_index < len(frames):
        frame = frames[next_index]
        if isinstance(frame, list) and joint < len(frame) and point_xy(frame[joint]) is not None:
            break
        next_index += 1
    if prev_index < 0 or next_index >= len(frames):
        return 0
    prev_xy = point_xy(frames[prev_index][joint])
    next_xy = point_xy(frames[next_index][joint])
    if not prev_xy or not next_xy:
        return 0
    corrected = 0
    span = next_index - prev_index
    for frame_index in range(start, end + 1):
        frame = frames[frame_index]
        if not isinstance(frame, list) or joint >= len(frame):
            continue
        alpha = (frame_index - prev_index) / span
        frame[joint][0] = round(prev_xy[0] * (1.0 - alpha) + next_xy[0] * alpha, 6)
        frame[joint][1] = round(prev_xy[1] * (1.0 - alpha) + next_xy[1] * alpha, 6)
        corrected += 1
    return corrected


def smooth_pose_frames(
    pose_frames: list[Any],
    window_radius: int,
    max_interpolate_run: int,
    low_confidence_threshold: float,
    local_deviation_threshold: float,
    blend_alpha: float,
) -> tuple[list[Any], dict[str, Any]]:
    smoothed = copy.deepcopy(pose_frames)
    scale_px = shoulder_width_px(pose_frames)
    local_frames = local_pose_points(pose_frames)
    threshold = max(8.0, local_deviation_threshold * scale_px)
    blend_limit = max(4.0, threshold * 0.7)
    max_points = max((len(frame) for frame in pose_frames if isinstance(frame, list)), default=0)
    outliers = [[False for _ in range(max_points)] for _ in pose_frames]
    detected = 0
    blended = 0

    for joint in UPPER_BODY_POSE_INDICES:
        if joint >= max_points:
            continue
        for frame_index, frame in enumerate(pose_frames):
            if not isinstance(frame, list) or joint >= len(frame):
                continue
            xy = point_xy(frame[joint])
            anchor = pose_anchor(frame)
            median_local = window_median_local(local_frames, pose_frames, joint, frame_index, window_radius)
            if xy is None or anchor is None or median_local is None:
                continue
            local_point = local_frames[frame_index][joint] if joint < len(local_frames[frame_index]) else None
            if local_point is None:
                continue
            deviation = distance(local_point, median_local)
            if deviation > threshold or (confidence(frame[joint]) < low_confidence_threshold and deviation > threshold * 0.5):
                outliers[frame_index][joint] = True
                detected += 1

    corrected = 0
    for joint in UPPER_BODY_POSE_INDICES:
        if joint >= max_points:
            continue
        flags = [frame_flags[joint] if joint < len(frame_flags) else False for frame_flags in outliers]
        for start, end in find_runs(flags):
            if end - start + 1 <= max_interpolate_run:
                corrected += interpolate_pose_run(smoothed, joint, start, end)

    # A light median blend damps tiny detector jitter without moving fast pose changes.
    smoothed_local = local_pose_points(smoothed)
    for joint in UPPER_BODY_POSE_INDICES:
        if joint >= max_points:
            continue
        for frame_index, frame in enumerate(smoothed):
            if not isinstance(frame, list) or joint >= len(frame):
                continue
            if outliers[frame_index][joint]:
                continue
            xy = point_xy(frame[joint])
            anchor = pose_anchor(frame)
            median_local = window_median_local(smoothed_local, smoothed, joint, frame_index, window_radius)
            local_point = smoothed_local[frame_index][joint] if joint < len(smoothed_local[frame_index]) else None
            if xy is None or anchor is None or median_local is None or local_point is None:
                continue
            deviation = distance(local_point, median_local)
            if 1e-6 < deviation <= blend_limit:
                target_x = anchor[0] + median_local[0]
                target_y = anchor[1] + median_local[1]
                frame[joint][0] = round(xy[0] * (1.0 - blend_alpha) + target_x * blend_alpha, 6)
                frame[joint][1] = round(xy[1] * (1.0 - blend_alpha) + target_y * blend_alpha, 6)
                blended += 1

    return smoothed, {
        "detected_outlier_points": detected,
        "interpolated_points": corrected,
        "blended_points": blended,
        "scale_px": round(scale_px, 6),
    }


def translate_frame_points(frame: Any, dx: float, dy: float) -> int:
    if not isinstance(frame, list):
        return 0
    changed = 0
    for point in frame:
        if not isinstance(point, list) or len(point) < 2:
            continue
        xy = point_xy(point)
        if xy is None or confidence(point) <= 0.01:
            continue
        point[0] = round(xy[0] + dx, 6)
        point[1] = round(xy[1] + dy, 6)
        changed += 1
    return changed


def smooth_body_translation_frames(
    pose_frames: list[Any],
    left_frames: list[Any],
    right_frames: list[Any],
    window_radius: int,
    max_translation_px: float,
    alpha: float,
) -> tuple[list[Any], list[Any], list[Any], dict[str, Any]]:
    smoothed_pose = copy.deepcopy(pose_frames)
    smoothed_left = copy.deepcopy(left_frames)
    smoothed_right = copy.deepcopy(right_frames)
    anchors = [pose_anchor(frame) for frame in pose_frames]
    applied_frames = 0
    shifted_points = 0
    max_applied_delta = 0.0

    for frame_index, anchor in enumerate(anchors):
        if anchor is None:
            continue
        neighbors = [
            other_anchor
            for other_index in range(max(0, frame_index - window_radius), min(len(anchors), frame_index + window_radius + 1))
            if other_index != frame_index and (other_anchor := anchors[other_index]) is not None
        ]
        target = median_point(neighbors)
        if target is None:
            continue
        raw_dx = target[0] - anchor[0]
        raw_dy = target[1] - anchor[1]
        raw_delta = math.hypot(raw_dx, raw_dy)
        if raw_delta <= 1e-6 or raw_delta > max_translation_px:
            continue
        dx = raw_dx * alpha
        dy = raw_dy * alpha
        applied_delta = math.hypot(dx, dy)
        if frame_index < len(smoothed_pose):
            shifted_points += translate_frame_points(smoothed_pose[frame_index], dx, dy)
        if frame_index < len(smoothed_left):
            shifted_points += translate_frame_points(smoothed_left[frame_index], dx, dy)
        if frame_index < len(smoothed_right):
            shifted_points += translate_frame_points(smoothed_right[frame_index], dx, dy)
        applied_frames += 1
        max_applied_delta = max(max_applied_delta, applied_delta)

    return smoothed_pose, smoothed_left, smoothed_right, {
        "applied_frames": applied_frames,
        "shifted_points": shifted_points,
        "max_applied_delta_px": round(max_applied_delta, 6),
        "max_translation_px": max_translation_px,
        "alpha": alpha,
    }


def smooth_torso_local_frames(
    pose_frames: list[Any],
    window_radius: int,
    alpha: float,
    max_delta_px: float,
) -> tuple[list[Any], dict[str, Any]]:
    smoothed = copy.deepcopy(pose_frames)
    anchors = [pose_anchor(frame) for frame in pose_frames]
    local_frames = local_pose_points(pose_frames)
    adjusted_points = 0
    max_applied_delta = 0.0

    for joint in TORSO_LOCAL_POSE_INDICES:
        for frame_index, frame in enumerate(smoothed):
            if not isinstance(frame, list) or joint >= len(frame):
                continue
            anchor = anchors[frame_index]
            xy = point_xy(frame[joint])
            local_point = local_frames[frame_index][joint] if joint < len(local_frames[frame_index]) else None
            if anchor is None or xy is None or local_point is None or confidence(frame[joint]) <= 0.01:
                continue
            target = window_median_local(local_frames, pose_frames, joint, frame_index, window_radius)
            if target is None:
                continue
            raw_delta = distance(local_point, target)
            if raw_delta <= 1e-6 or raw_delta > max_delta_px:
                continue
            new_local_x = local_point[0] * (1.0 - alpha) + target[0] * alpha
            new_local_y = local_point[1] * (1.0 - alpha) + target[1] * alpha
            new_x = anchor[0] + new_local_x
            new_y = anchor[1] + new_local_y
            applied_delta = math.hypot(new_x - xy[0], new_y - xy[1])
            frame[joint][0] = round(new_x, 6)
            frame[joint][1] = round(new_y, 6)
            adjusted_points += 1
            max_applied_delta = max(max_applied_delta, applied_delta)

    return smoothed, {
        "adjusted_points": adjusted_points,
        "max_applied_delta_px": round(max_applied_delta, 6),
        "max_delta_px": max_delta_px,
        "alpha": alpha,
    }


def load_selected_words(selection_json: Path, word_root: Path, include_pattern: str, limit: int) -> list[str]:
    words: list[str] = []
    if selection_json.exists():
        payload = load_json(selection_json)
        if isinstance(payload.get("selected_words"), list):
            words = [str(word) for word in payload["selected_words"]]
        elif isinstance(payload.get("selected"), list):
            words = [str(item.get("word")) for item in payload["selected"] if isinstance(item, dict) and item.get("word")]
    if not words:
        words = [
            path.stem
            for path in sorted(word_root.glob(include_pattern))
            if not path.name.startswith(("smooth2d_", "smooth2d_v2_"))
        ]
    if limit > 0:
        words = words[:limit]
    return words


def config_from_args(args: argparse.Namespace) -> FingerJitterConfig:
    return FingerJitterConfig(
        low_confidence_threshold=args.low_confidence_threshold,
        motion_ratio_threshold=args.motion_ratio_threshold,
        local_deviation_threshold=args.local_deviation_threshold,
        window_radius=args.window_radius,
        max_interpolate_run=args.max_interpolate_run,
        bone_min_ratio=args.bone_min_ratio,
        bone_max_ratio=args.bone_max_ratio,
        tip_strictness=args.tip_strictness,
        mcp_strictness=args.mcp_strictness,
        pip_min_angle_deg=args.pip_min_angle_deg,
        dip_min_angle_deg=args.dip_min_angle_deg,
        mcp_min_angle_deg=args.mcp_min_angle_deg,
        cross_hand_proximity_threshold=args.cross_hand_proximity_threshold,
    )


def process_word(task: tuple[int, str, dict[str, Any]]) -> dict[str, Any]:
    index, word, raw_args = task
    word_root = Path(raw_args["word_root"])
    output_prefix = raw_args["output_prefix"]
    write_copy = bool(raw_args["write_copy"])
    config = FingerJitterConfig(**raw_args["config"])
    smooth_pose = bool(raw_args["smooth_pose"])
    pose_local_deviation_threshold = float(raw_args["pose_local_deviation_threshold"])
    pose_blend_alpha = float(raw_args["pose_blend_alpha"])
    smooth_body_translation = bool(raw_args["smooth_body_translation"])
    body_translation_max_px = float(raw_args["body_translation_max_px"])
    body_translation_alpha = float(raw_args["body_translation_alpha"])
    smooth_torso_local = bool(raw_args["smooth_torso_local"])
    torso_local_alpha = float(raw_args["torso_local_alpha"])
    torso_local_max_delta_px = float(raw_args["torso_local_max_delta_px"])
    source_path = word_root / f"{word}.json"
    if not source_path.exists():
        return {
            "word": word,
            "index": index,
            "status": "failed",
            "reason": "source_missing",
            "source": str(source_path),
        }

    try:
        payload = load_json(source_path)
        sample = payload.get("sample") or {}
        keypoints = sample.get("keypoints") or {}
        image_2d = keypoints.get("image_2d") or {}
        pose_frames = values_for(image_2d, "pose")
        left_frames = values_for(image_2d, "left_hand")
        right_frames = values_for(image_2d, "right_hand")
        face_frames = values_for(image_2d, "face")
        if not pose_frames or not left_frames or not right_frames:
            return {
                "word": word,
                "index": index,
                "status": "skipped",
                "reason": "missing_required_image_2d_parts",
                "source": str(source_path),
            }

        if smooth_body_translation:
            pose_body_smoothed, left_body_smoothed, right_body_smoothed, body_stats = smooth_body_translation_frames(
                pose_frames,
                left_frames,
                right_frames,
                config.window_radius,
                body_translation_max_px,
                body_translation_alpha,
            )
        else:
            pose_body_smoothed = copy.deepcopy(pose_frames)
            left_body_smoothed = copy.deepcopy(left_frames)
            right_body_smoothed = copy.deepcopy(right_frames)
            body_stats = {
                "applied_frames": 0,
                "shifted_points": 0,
                "max_applied_delta_px": 0.0,
                "max_translation_px": body_translation_max_px,
                "alpha": body_translation_alpha,
            }

        if smooth_torso_local:
            pose_torso_smoothed, torso_stats = smooth_torso_local_frames(
                pose_body_smoothed,
                config.window_radius,
                torso_local_alpha,
                torso_local_max_delta_px,
            )
        else:
            pose_torso_smoothed = copy.deepcopy(pose_body_smoothed)
            torso_stats = {
                "adjusted_points": 0,
                "max_applied_delta_px": 0.0,
                "max_delta_px": torso_local_max_delta_px,
                "alpha": torso_local_alpha,
            }

        if smooth_pose:
            pose_smoothed, pose_stats = smooth_pose_frames(
                pose_torso_smoothed,
                config.window_radius,
                config.max_interpolate_run,
                config.low_confidence_threshold,
                pose_local_deviation_threshold,
                pose_blend_alpha,
            )
        else:
            pose_smoothed = copy.deepcopy(pose_torso_smoothed)
            pose_stats = {
                "detected_outlier_points": 0,
                "interpolated_points": 0,
                "blended_points": 0,
                "scale_px": round(shoulder_width_px(pose_torso_smoothed), 6),
            }

        correction = correct_finger_jitter_2d(pose_smoothed, left_body_smoothed, right_body_smoothed, config)
        output = copy.deepcopy(payload)
        output_word = f"{output_prefix}_{index:02d}_{word}"
        output["word"] = output_word
        output_sample = output.setdefault("sample", {})
        output_keypoints = output_sample.setdefault("keypoints", {})
        output_image_2d = copy.deepcopy(image_2d)
        output_image_2d["pose"] = shape_block(pose_smoothed, 25)
        if "face" in image_2d:
            output_image_2d["face"] = copy.deepcopy(image_2d["face"])
        elif face_frames:
            output_image_2d["face"] = shape_block(face_frames, 68)
        output_image_2d["left_hand"] = shape_block(correction.left_hand, 21)
        output_image_2d["right_hand"] = shape_block(correction.right_hand, 21)
        output_keypoints["image_2d"] = output_image_2d
        output_sample.setdefault("processing", {})["image_2d_preprocess_method"] = "finger_jitter_2d_v2"
        if smooth_body_translation:
            output_sample.setdefault("processing", {})["image_2d_body_smoothing_method"] = "body_translation_temporal_smoothing_v1"
        if smooth_torso_local:
            output_sample.setdefault("processing", {})["image_2d_torso_smoothing_method"] = "torso_local_temporal_smoothing_v1"
        if smooth_pose:
            output_sample.setdefault("processing", {})["image_2d_pose_smoothing_method"] = "upper_body_pose_temporal_smoothing_v1"
        output["viewer_qa_alias"] = {
            "source_word": word,
            "source_file": source_path.name,
            "qa_kind": output_prefix,
        }
        output_path = word_root / f"{output_word}.json"
        if write_copy:
            write_json(output_path, output)

        stats = {**correction.stats, "pose": pose_stats, "body": body_stats, "torso": torso_stats}
        return {
            "word": word,
            "index": index,
            "output_word": output_word,
            "source": str(source_path),
            "output": str(output_path),
            "status": "written" if write_copy else "dry_run",
            "frame_count": max(len(pose_frames), len(left_frames), len(right_frames)),
            "has_face": bool(face_frames),
            "stats": stats,
            "top_frame_risks": [
                {"word": output_word, **risk}
                for risk in correction.top_frame_risks[:20]
            ],
        }
    except Exception as exc:  # noqa: BLE001 - report per-file failures.
        return {
            "word": word,
            "index": index,
            "status": "failed",
            "reason": type(exc).__name__,
            "message": str(exc),
            "source": str(source_path),
        }


def aggregate_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    success = [item for item in results if item["status"] in {"written", "dry_run"}]
    skipped = [item for item in results if item["status"] == "skipped"]
    failed = [item for item in results if item["status"] == "failed"]
    totals = {
        "total_detected_outlier_points": 0,
        "total_interpolated_points": 0,
        "total_changed_points": 0,
        "pose_detected_outlier_points": 0,
        "pose_interpolated_points": 0,
        "pose_blended_points": 0,
        "body_translation_applied_frames": 0,
        "body_translation_shifted_points": 0,
        "body_translation_max_applied_delta_px": 0.0,
        "torso_local_adjusted_points": 0,
        "torso_local_max_applied_delta_px": 0.0,
        "confidence_outlier_points": 0,
        "motion_outlier_points": 0,
        "local_outlier_points": 0,
        "bone_outlier_points": 0,
        "angle_outlier_points": 0,
    }
    for item in success:
        stats = item.get("stats") or {}
        totals["total_detected_outlier_points"] += int(stats.get("total_detected_outlier_points", 0))
        totals["total_interpolated_points"] += int(stats.get("total_interpolated_points", 0))
        totals["total_changed_points"] += int(stats.get("total_changed_points", 0))
        pose_stats = stats.get("pose") or {}
        pose_detected = int(pose_stats.get("detected_outlier_points", 0))
        pose_interpolated = int(pose_stats.get("interpolated_points", 0))
        pose_blended = int(pose_stats.get("blended_points", 0))
        totals["pose_detected_outlier_points"] += pose_detected
        totals["pose_interpolated_points"] += pose_interpolated
        totals["pose_blended_points"] += pose_blended
        totals["total_detected_outlier_points"] += pose_detected
        totals["total_interpolated_points"] += pose_interpolated
        totals["total_changed_points"] += pose_interpolated + pose_blended
        body_stats = stats.get("body") or {}
        body_shifted = int(body_stats.get("shifted_points", 0))
        totals["body_translation_applied_frames"] += int(body_stats.get("applied_frames", 0))
        totals["body_translation_shifted_points"] += body_shifted
        totals["body_translation_max_applied_delta_px"] = max(
            float(totals["body_translation_max_applied_delta_px"]),
            float(body_stats.get("max_applied_delta_px", 0.0)),
        )
        totals["total_changed_points"] += body_shifted
        torso_stats = stats.get("torso") or {}
        torso_adjusted = int(torso_stats.get("adjusted_points", 0))
        totals["torso_local_adjusted_points"] += torso_adjusted
        totals["torso_local_max_applied_delta_px"] = max(
            float(totals["torso_local_max_applied_delta_px"]),
            float(torso_stats.get("max_applied_delta_px", 0.0)),
        )
        totals["total_changed_points"] += torso_adjusted
        for side in ("left", "right"):
            side_stats = stats.get(side) or {}
            totals["confidence_outlier_points"] += int(side_stats.get("confidence_outlier_points", 0))
            totals["motion_outlier_points"] += int(side_stats.get("motion_outlier_points", 0))
            totals["local_outlier_points"] += int(side_stats.get("local_outlier_points", 0))
            totals["bone_outlier_points"] += int(side_stats.get("bone_outlier_points", 0))
            totals["angle_outlier_points"] += int(side_stats.get("angle_outlier_points", 0))
    return {
        "total_files": len(results),
        "processed_files": len(success),
        "skipped_files": len(skipped),
        "failed_files": len(failed),
        **totals,
    }


def collect_top_frames(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for result in results:
        frames.extend(result.get("top_frame_risks") or [])
    return sorted(frames, key=lambda item: item.get("severity", 0), reverse=True)[:limit]


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    summary = report["summary"]
    top_words = sorted(
        [item for item in report["results"] if item["status"] in {"written", "dry_run"}],
        key=lambda item: int((item.get("stats") or {}).get("total_changed_points", 0)),
        reverse=True,
    )[:30]
    lines = [
        "# 2D Keypoint Preprocess v2 Summary",
        "",
        f"- Total files: `{summary['total_files']}`",
        f"- Processed files: `{summary['processed_files']}`",
        f"- Skipped files: `{summary['skipped_files']}`",
        f"- Failed files: `{summary['failed_files']}`",
        f"- Detected outlier points: `{summary['total_detected_outlier_points']}`",
        f"- Interpolated points: `{summary['total_interpolated_points']}`",
        f"- Changed points: `{summary['total_changed_points']}`",
        f"- Pose detected points: `{summary.get('pose_detected_outlier_points', 0)}`",
        f"- Pose interpolated points: `{summary.get('pose_interpolated_points', 0)}`",
        f"- Pose blended points: `{summary.get('pose_blended_points', 0)}`",
        f"- Body translation frames: `{summary.get('body_translation_applied_frames', 0)}`",
        f"- Body shifted points: `{summary.get('body_translation_shifted_points', 0)}`",
        f"- Body max applied delta px: `{summary.get('body_translation_max_applied_delta_px', 0.0)}`",
        f"- Torso local adjusted points: `{summary.get('torso_local_adjusted_points', 0)}`",
        f"- Torso local max applied delta px: `{summary.get('torso_local_max_applied_delta_px', 0.0)}`",
        "",
        "## Top Changed Words",
        "",
        "| Rank | Word | Frames | Outliers | Interpolated | Changed | Max Jump Before | Max Jump After |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rank, item in enumerate(top_words, start=1):
        stats = item.get("stats") or {}
        left = stats.get("left") or {}
        right = stats.get("right") or {}
        before = max(float(left.get("max_joint_jump_before", 0.0)), float(right.get("max_joint_jump_before", 0.0)))
        after = max(float(left.get("max_joint_jump_after", 0.0)), float(right.get("max_joint_jump_after", 0.0)))
        lines.append(
            "| "
            f"{rank} | {item.get('output_word', item.get('word'))} | {item.get('frame_count', 0)} | "
            f"{stats.get('total_detected_outlier_points', 0)} | "
            f"{stats.get('total_interpolated_points', 0)} | "
            f"{stats.get('total_changed_points', 0)} | "
            f"{before:.3f} | {after:.3f} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.clean and args.write_copy:
        for path in args.word_root.glob(f"{args.output_prefix}_*.json"):
            path.unlink()

    words = load_selected_words(args.selection_json, args.word_root, args.include_pattern, args.limit)
    config = config_from_args(args)
    raw_args = {
        "word_root": args.word_root,
        "output_prefix": args.output_prefix,
        "write_copy": args.write_copy,
        "config": config.__dict__,
        "smooth_pose": args.smooth_pose,
        "pose_local_deviation_threshold": args.pose_local_deviation_threshold,
        "pose_blend_alpha": args.pose_blend_alpha,
        "smooth_body_translation": args.smooth_body_translation,
        "body_translation_max_px": args.body_translation_max_px,
        "body_translation_alpha": args.body_translation_alpha,
        "smooth_torso_local": args.smooth_torso_local,
        "torso_local_alpha": args.torso_local_alpha,
        "torso_local_max_delta_px": args.torso_local_max_delta_px,
    }
    tasks = [(index, word, raw_args) for index, word in enumerate(words)]
    if args.workers > 1 and len(tasks) > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            results = list(executor.map(process_word, tasks))
    else:
        results = [process_word(task) for task in tasks]
    results.sort(key=lambda item: int(item.get("index", 0)))

    top_frames = collect_top_frames(results, args.top_frame_limit)
    report = {
        "schema_version": "finger-jitter-2d-preprocess/v2",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "word_root": str(args.word_root),
            "selection_json": str(args.selection_json),
            "include_pattern": args.include_pattern,
            "output_dir": str(args.output_dir),
            "output_prefix": args.output_prefix,
            "write_copy": args.write_copy,
            "workers": args.workers,
            "correction": config.__dict__,
            "pose_smoothing": {
                "enabled": args.smooth_pose,
                "local_deviation_threshold": args.pose_local_deviation_threshold,
                "blend_alpha": args.pose_blend_alpha,
            },
            "body_translation_smoothing": {
                "enabled": args.smooth_body_translation,
                "max_px": args.body_translation_max_px,
                "alpha": args.body_translation_alpha,
            },
            "torso_local_smoothing": {
                "enabled": args.smooth_torso_local,
                "alpha": args.torso_local_alpha,
                "max_delta_px": args.torso_local_max_delta_px,
            },
        },
        "summary": aggregate_summary(results),
        "results": results,
    }
    report_path = args.output_dir / "2d_preprocess_v2_report.json"
    top_frames_path = args.output_dir / "2d_preprocess_v2_top_outlier_frames.jsonl"
    write_json(report_path, report)
    top_frames_path.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in top_frames) + ("\n" if top_frames else ""),
        encoding="utf-8",
    )
    markdown_path = None
    if args.markdown:
        markdown_path = args.output_dir / "2d_preprocess_v2_summary.md"
        write_markdown(markdown_path, report)

    print(json.dumps({
        "selected_count": len(words),
        "processed_count": report["summary"]["processed_files"],
        "skipped_count": report["summary"]["skipped_files"],
        "failed_count": report["summary"]["failed_files"],
        "report": str(report_path),
        "top_frames": str(top_frames_path),
        "markdown": str(markdown_path) if markdown_path else None,
    }, ensure_ascii=False, indent=2))
    return 0 if report["summary"]["failed_files"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
