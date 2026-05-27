#!/usr/bin/env python3
"""Joint-wise 2D hand keypoint jitter correction.

This module is intentionally independent from older smoothing scripts. It
detects short hand-keypoint extraction failures and only edits affected finger
joints, leaving wrist, pose, face, metadata, and confidence values intact.
"""

from __future__ import annotations

import copy
import math
from dataclasses import asdict, dataclass, field
from statistics import median
from typing import Any


HAND_JOINT_COUNT = 21
HAND_WRIST_INDEX = 0
HAND_PALM_INDICES = (0, 5, 9, 13, 17)
HAND_CHAINS = {
    "thumb": (0, 1, 2, 3, 4),
    "index": (0, 5, 6, 7, 8),
    "middle": (0, 9, 10, 11, 12),
    "ring": (0, 13, 14, 15, 16),
    "pinky": (0, 17, 18, 19, 20),
}
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
ANGLE_TRIPLETS = (
    (0, 1, 2, "mcp"),
    (1, 2, 3, "pip"),
    (2, 3, 4, "dip"),
    (0, 5, 6, "mcp"),
    (5, 6, 7, "pip"),
    (6, 7, 8, "dip"),
    (0, 9, 10, "mcp"),
    (9, 10, 11, "pip"),
    (10, 11, 12, "dip"),
    (0, 13, 14, "mcp"),
    (13, 14, 15, "pip"),
    (14, 15, 16, "dip"),
    (0, 17, 18, "mcp"),
    (17, 18, 19, "pip"),
    (18, 19, 20, "dip"),
)

BODY25_RIGHT_SHOULDER = 2
BODY25_LEFT_SHOULDER = 5


@dataclass(frozen=True)
class FingerJitterConfig:
    low_confidence_threshold: float = 0.2
    motion_ratio_threshold: float = 3.0
    local_deviation_threshold: float = 0.08
    window_radius: int = 3
    max_interpolate_run: int = 3
    bone_min_ratio: float = 0.5
    bone_max_ratio: float = 1.8
    tip_strictness: float = 1.25
    mcp_strictness: float = 0.75
    pip_min_angle_deg: float = 25.0
    dip_min_angle_deg: float = 20.0
    mcp_min_angle_deg: float = 18.0
    cross_hand_proximity_threshold: float = 0.13
    min_shoulder_width_px: float = 80.0


@dataclass
class FingerCorrectionResult:
    left_hand: list[Any]
    right_hand: list[Any]
    stats: dict[str, Any]
    top_frame_risks: list[dict[str, Any]] = field(default_factory=list)


def correct_finger_jitter_2d(
    pose_frames: list[Any],
    left_hand_frames: list[Any],
    right_hand_frames: list[Any],
    config: FingerJitterConfig | None = None,
) -> FingerCorrectionResult:
    """Correct left/right hand 2D finger jitter without mutating inputs."""

    cfg = config or FingerJitterConfig()
    scale_px = shoulder_width_px(pose_frames, cfg.min_shoulder_width_px)
    left_result = correct_hand_frames(left_hand_frames, "left", scale_px, cfg, right_hand_frames)
    right_result = correct_hand_frames(right_hand_frames, "right", scale_px, cfg, left_hand_frames)

    stats = {
        "method": "finger_jitter_2d_v2",
        "config": asdict(cfg),
        "shoulder_width_px": round(scale_px, 6),
        "left": left_result["stats"],
        "right": right_result["stats"],
        "total_detected_outlier_points": int(
            left_result["stats"]["detected_outlier_points"]
            + right_result["stats"]["detected_outlier_points"]
        ),
        "total_interpolated_points": int(
            left_result["stats"]["interpolated_points"]
            + right_result["stats"]["interpolated_points"]
        ),
        "total_changed_points": int(
            left_result["stats"]["changed_points"]
            + right_result["stats"]["changed_points"]
        ),
    }
    top_risks = sorted(
        left_result["top_frame_risks"] + right_result["top_frame_risks"],
        key=lambda item: item["severity"],
        reverse=True,
    )
    return FingerCorrectionResult(
        left_hand=left_result["frames"],
        right_hand=right_result["frames"],
        stats=stats,
        top_frame_risks=top_risks,
    )


def correct_hand_frames(
    frames: list[Any],
    hand: str,
    scale_px: float,
    cfg: FingerJitterConfig,
    opposite_frames: list[Any] | None = None,
) -> dict[str, Any]:
    original = normalize_hand_frames(frames)
    corrected = copy.deepcopy(original)
    opposite_original = normalize_hand_frames(opposite_frames or [])
    outlier_reasons = detect_outliers(original, hand, scale_px, cfg)
    correction_reasons = correction_outliers(outlier_reasons)
    cross_hand_suppressed = suppress_cross_hand_ambiguous_corrections(
        correction_reasons,
        original,
        opposite_original,
        scale_px,
        cfg,
    )
    stats: dict[str, Any] = {
        "frame_count": len(original),
        "detected_outlier_points": count_outliers(outlier_reasons),
        "corrected_outlier_points": count_outliers(correction_reasons),
        "cross_hand_suppressed_points": cross_hand_suppressed,
        "confidence_outlier_points": count_reason(outlier_reasons, "confidence"),
        "motion_outlier_points": count_reason(outlier_reasons, "motion"),
        "local_outlier_points": count_reason(outlier_reasons, "local"),
        "bone_outlier_points": count_reason(outlier_reasons, "bone"),
        "interpolated_points": 0,
        "one_sided_clamped_points": 0,
        "bone_clamped_points": 0,
        "angle_clamped_points": 0,
        "changed_points": 0,
        "max_joint_jump_before": round(max_joint_jump(original), 6),
    }

    stats["interpolated_points"], stats["one_sided_clamped_points"] = interpolate_outliers(
        corrected,
        correction_reasons,
        scale_px,
        cfg,
    )
    stats["bone_clamped_points"] = clamp_bone_lengths(corrected, correction_reasons, cfg)
    stats["angle_clamped_points"] = clamp_joint_angles(corrected, correction_reasons, cfg)
    stats["detected_outlier_points"] = count_outliers(outlier_reasons)
    stats["corrected_outlier_points"] = count_outliers(correction_reasons)
    stats["angle_outlier_points"] = count_reason(outlier_reasons, "angle")
    stats["changed_points"] = count_changed_points(original, corrected)
    stats["max_joint_jump_after"] = round(max_joint_jump(corrected), 6)
    stats["bone_max_ratio_before"] = round(max_bone_ratio(original), 6)
    stats["bone_max_ratio_after"] = round(max_bone_ratio(corrected), 6)
    stats["joint_outlier_counts"] = {
        str(joint): sum(1 for frame in outlier_reasons if frame[joint])
        for joint in range(1, HAND_JOINT_COUNT)
    }

    risks = build_frame_risks(original, outlier_reasons, hand)
    return {"frames": corrected, "stats": stats, "top_frame_risks": risks}


def correction_outliers(outliers: list[list[set[str]]]) -> list[list[set[str]]]:
    """Return only outliers that are safe enough to edit.

    A local-neighborhood deviation by itself is too ambiguous for sign language
    motion: a valid fast handshape change can look locally unusual. Keep those
    points in the report, but only edit them when another stronger signal also
    fires, such as motion, bone length, missing, or low confidence.
    """

    correction: list[list[set[str]]] = []
    for frame in outliers:
        correction_frame: list[set[str]] = []
        for reasons in frame:
            if reasons and reasons != {"local"}:
                correction_frame.append(set(reasons))
            else:
                correction_frame.append(set())
        correction.append(correction_frame)
    return correction


def suppress_cross_hand_ambiguous_corrections(
    correction: list[list[set[str]]],
    frames: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    scale_px: float,
    cfg: FingerJitterConfig,
) -> int:
    """Avoid changing ambiguous finger points while two hands are touching.

    When both hands are close, a per-hand motion test can mistake real contact
    or overlap for jitter. Suppress weak corrections in that situation; strong
    signals such as low confidence, missing, or broken bone length still pass.
    """

    if not frames or not opposite_frames:
        return 0
    threshold = max(20.0, cfg.cross_hand_proximity_threshold * scale_px)
    strong_reasons = {"confidence", "missing", "bone"}
    suppressed = 0
    frame_count = min(len(frames), len(opposite_frames), len(correction))
    for frame_index in range(frame_count):
        opposite_points = [
            point_xy(point)
            for point in opposite_frames[frame_index]
            if confidence(point) >= cfg.low_confidence_threshold
        ]
        opposite_points = [point for point in opposite_points if point is not None]
        if not opposite_points:
            continue
        for joint in range(1, HAND_JOINT_COUNT):
            reasons = correction[frame_index][joint]
            if not reasons or reasons & strong_reasons:
                continue
            joint_xy = point_xy(frames[frame_index][joint])
            if not joint_xy:
                continue
            nearest = min(distance(joint_xy, opposite) for opposite in opposite_points)
            if nearest <= threshold:
                reasons.clear()
                suppressed += 1
    return suppressed


def detect_outliers(
    frames: list[list[list[float]]],
    hand: str,
    scale_px: float,
    cfg: FingerJitterConfig,
) -> list[list[set[str]]]:
    outliers: list[list[set[str]]] = [
        [set() for _ in range(HAND_JOINT_COUNT)] for _ in frames
    ]
    if not frames:
        return outliers

    palm_centers = [palm_center(frame) for frame in frames]
    local_frames = local_hand_points(frames, palm_centers)
    bone_medians = median_bone_lengths(frames)
    base_threshold = max(8.0, cfg.local_deviation_threshold * scale_px)

    for frame_index, frame in enumerate(frames):
        for joint in range(1, HAND_JOINT_COUNT):
            if confidence(frame[joint]) < cfg.low_confidence_threshold:
                outliers[frame_index][joint].add("confidence")

    for joint in range(1, HAND_JOINT_COUNT):
        strictness = joint_strictness(joint, cfg)
        local_threshold = base_threshold / strictness
        for frame_index, frame in enumerate(frames):
            local_point = local_frames[frame_index][joint]
            if local_point is None:
                outliers[frame_index][joint].add("missing")
                continue

            median_local = window_median_point(local_frames, joint, frame_index, cfg.window_radius)
            if median_local and distance(local_point, median_local) > local_threshold:
                outliers[frame_index][joint].add("local")

            if frame_index > 0:
                current = point_xy(frame[joint])
                prev = point_xy(frames[frame_index - 1][joint])
                if current and prev:
                    palm_delta = palm_motion(palm_centers, frame_index)
                    joint_delta = distance(current, prev)
                    local_prev = local_frames[frame_index - 1][joint]
                    local_delta = distance(local_point, local_prev) if local_prev else joint_delta
                    absolute_threshold = max(10.0, local_threshold * 0.65)
                    ratio_threshold = cfg.motion_ratio_threshold * max(3.0, palm_delta)
                    if local_delta > absolute_threshold and joint_delta > ratio_threshold:
                        outliers[frame_index][joint].add("motion")

            parent = HAND_PARENT.get(joint)
            median_length = bone_medians.get(joint)
            if parent is not None and median_length:
                parent_xy = point_xy(frame[parent])
                joint_xy = point_xy(frame[joint])
                if parent_xy and joint_xy:
                    length = distance(parent_xy, joint_xy)
                    if length < median_length * cfg.bone_min_ratio or length > median_length * cfg.bone_max_ratio:
                        outliers[frame_index][joint].add("bone")

    return outliers


def interpolate_outliers(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    scale_px: float,
    cfg: FingerJitterConfig,
) -> tuple[int, int]:
    interpolated = 0
    clamped = 0
    max_one_sided_move = max(8.0, cfg.local_deviation_threshold * scale_px)

    for joint in range(1, HAND_JOINT_COUNT):
        frame_index = 0
        while frame_index < len(frames):
            if not outliers[frame_index][joint]:
                frame_index += 1
                continue

            start = frame_index
            while frame_index < len(frames) and outliers[frame_index][joint]:
                frame_index += 1
            end = frame_index - 1
            run_length = end - start + 1
            if run_length > cfg.max_interpolate_run:
                continue

            prev_index = previous_valid_index(frames, outliers, joint, start)
            next_index = next_valid_index(frames, outliers, joint, end)
            if prev_index is not None and next_index is not None:
                prev_point = frames[prev_index][joint]
                next_point = frames[next_index][joint]
                for current_index in range(start, end + 1):
                    alpha = (current_index - prev_index) / (next_index - prev_index)
                    frames[current_index][joint][0] = lerp(prev_point[0], next_point[0], alpha)
                    frames[current_index][joint][1] = lerp(prev_point[1], next_point[1], alpha)
                    interpolated += 1
            elif prev_index is not None:
                base = frames[prev_index][joint]
                for current_index in range(start, end + 1):
                    clamped += clamp_point_to_base(frames[current_index][joint], base, max_one_sided_move)
            elif next_index is not None:
                base = frames[next_index][joint]
                for current_index in range(start, end + 1):
                    clamped += clamp_point_to_base(frames[current_index][joint], base, max_one_sided_move)
    return interpolated, clamped


def clamp_bone_lengths(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    cfg: FingerJitterConfig,
) -> int:
    medians = median_bone_lengths(frames)
    changed = 0
    for frame_index, frame in enumerate(frames):
        for joint, parent in HAND_PARENT.items():
            if not outliers[frame_index][joint]:
                continue
            median_length = medians.get(joint)
            parent_xy = point_xy(frame[parent])
            child_xy = point_xy(frame[joint])
            if not median_length or not parent_xy or not child_xy:
                continue
            current_length = distance(parent_xy, child_xy)
            if current_length <= 1e-6:
                continue
            target_length = min(
                median_length * cfg.bone_max_ratio,
                max(median_length * cfg.bone_min_ratio, current_length),
            )
            if abs(target_length - current_length) <= 1e-6:
                continue
            scale = target_length / current_length
            frame[joint][0] = parent_xy[0] + (child_xy[0] - parent_xy[0]) * scale
            frame[joint][1] = parent_xy[1] + (child_xy[1] - parent_xy[1]) * scale
            changed += 1
    return changed


def clamp_joint_angles(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    cfg: FingerJitterConfig,
) -> int:
    changed = 0
    min_angle_by_kind = {
        "mcp": math.radians(cfg.mcp_min_angle_deg),
        "pip": math.radians(cfg.pip_min_angle_deg),
        "dip": math.radians(cfg.dip_min_angle_deg),
    }
    for frame_index, frame in enumerate(frames):
        for parent, joint, child, kind in ANGLE_TRIPLETS:
            if not outliers[frame_index][joint] and not outliers[frame_index][child]:
                continue
            parent_xy = point_xy(frame[parent])
            joint_xy = point_xy(frame[joint])
            child_xy = point_xy(frame[child])
            if not parent_xy or not joint_xy or not child_xy:
                continue
            current_angle = angle_between(
                (parent_xy[0] - joint_xy[0], parent_xy[1] - joint_xy[1]),
                (child_xy[0] - joint_xy[0], child_xy[1] - joint_xy[1]),
            )
            min_angle = min_angle_by_kind[kind]
            if current_angle >= min_angle:
                continue
            child_length = distance(joint_xy, child_xy)
            if child_length <= 1e-6:
                continue
            toward_parent = unit_vector((parent_xy[0] - joint_xy[0], parent_xy[1] - joint_xy[1]))
            current_child = unit_vector((child_xy[0] - joint_xy[0], child_xy[1] - joint_xy[1]))
            side = 1.0 if cross_2d(toward_parent, current_child) >= 0 else -1.0
            target_dir = rotate_vector(toward_parent, side * min_angle)
            frame[child][0] = joint_xy[0] + target_dir[0] * child_length
            frame[child][1] = joint_xy[1] + target_dir[1] * child_length
            outliers[frame_index][child].add("angle")
            changed += 1
    return changed


def normalize_hand_frames(frames: list[Any]) -> list[list[list[float]]]:
    normalized: list[list[list[float]]] = []
    for frame in frames:
        normalized_frame: list[list[float]] = []
        if not isinstance(frame, list):
            frame = []
        for joint in range(HAND_JOINT_COUNT):
            point = frame[joint] if joint < len(frame) and isinstance(frame[joint], list) else []
            x = finite_float(point[0] if len(point) > 0 else 0.0)
            y = finite_float(point[1] if len(point) > 1 else 0.0)
            conf = finite_float(point[2] if len(point) > 2 else 0.0)
            normalized_frame.append([x, y, conf])
        normalized.append(normalized_frame)
    return normalized


def shoulder_width_px(pose_frames: list[Any], minimum: float) -> float:
    widths: list[float] = []
    for frame in pose_frames:
        if not isinstance(frame, list):
            continue
        if len(frame) <= max(BODY25_RIGHT_SHOULDER, BODY25_LEFT_SHOULDER):
            continue
        right = point_xy(frame[BODY25_RIGHT_SHOULDER])
        left = point_xy(frame[BODY25_LEFT_SHOULDER])
        if right and left:
            widths.append(distance(right, left))
    return max(minimum, median(widths) if widths else minimum)


def palm_center(frame: list[list[float]]) -> tuple[float, float] | None:
    points = [
        point_xy(frame[index])
        for index in HAND_PALM_INDICES
        if index < len(frame) and confidence(frame[index]) > 0.01
    ]
    valid = [point for point in points if point is not None]
    if not valid:
        return None
    return median([point[0] for point in valid]), median([point[1] for point in valid])


def local_hand_points(
    frames: list[list[list[float]]],
    palm_centers: list[tuple[float, float] | None],
) -> list[list[tuple[float, float] | None]]:
    local_frames: list[list[tuple[float, float] | None]] = []
    for frame, center in zip(frames, palm_centers, strict=True):
        local_frame: list[tuple[float, float] | None] = []
        for point in frame:
            xy = point_xy(point)
            if xy is None or center is None or confidence(point) <= 0.01:
                local_frame.append(None)
            else:
                local_frame.append((xy[0] - center[0], xy[1] - center[1]))
        local_frames.append(local_frame)
    return local_frames


def window_median_point(
    local_frames: list[list[tuple[float, float] | None]],
    joint: int,
    frame_index: int,
    radius: int,
) -> tuple[float, float] | None:
    points: list[tuple[float, float]] = []
    for other_index in range(max(0, frame_index - radius), min(len(local_frames), frame_index + radius + 1)):
        if other_index == frame_index:
            continue
        point = local_frames[other_index][joint]
        if point is not None:
            points.append(point)
    if not points:
        return None
    return median([point[0] for point in points]), median([point[1] for point in points])


def median_bone_lengths(frames: list[list[list[float]]]) -> dict[int, float]:
    lengths_by_joint: dict[int, list[float]] = {joint: [] for joint in HAND_PARENT}
    for frame in frames:
        for joint, parent in HAND_PARENT.items():
            if confidence(frame[joint]) <= 0.01 or confidence(frame[parent]) <= 0.01:
                continue
            child = point_xy(frame[joint])
            base = point_xy(frame[parent])
            if child and base:
                lengths_by_joint[joint].append(distance(base, child))
    return {
        joint: median(lengths)
        for joint, lengths in lengths_by_joint.items()
        if lengths and median(lengths) > 1e-6
    }


def max_bone_ratio(frames: list[list[list[float]]]) -> float:
    medians = median_bone_lengths(frames)
    ratios: list[float] = []
    for frame in frames:
        for joint, parent in HAND_PARENT.items():
            median_length = medians.get(joint)
            if not median_length:
                continue
            child = point_xy(frame[joint])
            base = point_xy(frame[parent])
            if child and base:
                length = distance(base, child)
                ratios.append(max(length / median_length, median_length / max(length, 1e-6)))
    return max(ratios) if ratios else 0.0


def max_joint_jump(frames: list[list[list[float]]]) -> float:
    jumps: list[float] = []
    for frame_index in range(1, len(frames)):
        for joint in range(1, HAND_JOINT_COUNT):
            current = point_xy(frames[frame_index][joint])
            previous = point_xy(frames[frame_index - 1][joint])
            if current and previous:
                jumps.append(distance(previous, current))
    return max(jumps) if jumps else 0.0


def build_frame_risks(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    hand: str,
) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    for frame_index, frame in enumerate(outliers):
        for joint, reasons in enumerate(frame):
            if joint == HAND_WRIST_INDEX or not reasons:
                continue
            severity = len(reasons)
            risks.append(
                {
                    "hand": hand,
                    "frame_index": frame_index,
                    "joint": joint,
                    "reasons": sorted(reasons),
                    "severity": severity,
                    "confidence": round(confidence(frames[frame_index][joint]), 6),
                }
            )
    return sorted(risks, key=lambda item: item["severity"], reverse=True)


def joint_strictness(joint: int, cfg: FingerJitterConfig) -> float:
    if joint in (4, 8, 12, 16, 20):
        return cfg.tip_strictness
    if joint in (1, 5, 9, 13, 17):
        return cfg.mcp_strictness
    return 1.0


def palm_motion(
    palm_centers: list[tuple[float, float] | None],
    frame_index: int,
) -> float:
    if frame_index <= 0:
        return 0.0
    current = palm_centers[frame_index]
    previous = palm_centers[frame_index - 1]
    if current is None or previous is None:
        return 0.0
    return distance(previous, current)


def previous_valid_index(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    joint: int,
    start: int,
) -> int | None:
    for index in range(start - 1, -1, -1):
        if not outliers[index][joint] and point_xy(frames[index][joint]) is not None:
            return index
    return None


def next_valid_index(
    frames: list[list[list[float]]],
    outliers: list[list[set[str]]],
    joint: int,
    end: int,
) -> int | None:
    for index in range(end + 1, len(frames)):
        if not outliers[index][joint] and point_xy(frames[index][joint]) is not None:
            return index
    return None


def clamp_point_to_base(point: list[float], base: list[float], max_distance: float) -> int:
    current = point_xy(point)
    base_xy = point_xy(base)
    if current is None or base_xy is None:
        return 0
    current_distance = distance(base_xy, current)
    if current_distance <= max_distance or current_distance <= 1e-6:
        return 0
    scale = max_distance / current_distance
    point[0] = base_xy[0] + (current[0] - base_xy[0]) * scale
    point[1] = base_xy[1] + (current[1] - base_xy[1]) * scale
    return 1


def count_changed_points(before: list[list[list[float]]], after: list[list[list[float]]]) -> int:
    changed = 0
    for before_frame, after_frame in zip(before, after, strict=True):
        for joint in range(1, HAND_JOINT_COUNT):
            if abs(before_frame[joint][0] - after_frame[joint][0]) > 1e-6 or abs(before_frame[joint][1] - after_frame[joint][1]) > 1e-6:
                changed += 1
    return changed


def count_outliers(outliers: list[list[set[str]]]) -> int:
    return sum(1 for frame in outliers for joint in frame[1:] if joint)


def count_reason(outliers: list[list[set[str]]], reason: str) -> int:
    return sum(1 for frame in outliers for joint in frame[1:] if reason in joint)


def finite_float(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if math.isfinite(result) else 0.0


def point_xy(point: Any) -> tuple[float, float] | None:
    if not isinstance(point, list) or len(point) < 2:
        return None
    x = finite_float(point[0])
    y = finite_float(point[1])
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return x, y


def confidence(point: Any) -> float:
    if not isinstance(point, list) or len(point) < 3:
        return 0.0
    return finite_float(point[2])


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def lerp(a: float, b: float, alpha: float) -> float:
    return a + (b - a) * alpha


def angle_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    a_len = math.hypot(a[0], a[1])
    b_len = math.hypot(b[0], b[1])
    if a_len <= 1e-6 or b_len <= 1e-6:
        return math.pi
    value = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (a_len * b_len)))
    return math.acos(value)


def unit_vector(vector: tuple[float, float]) -> tuple[float, float]:
    length = math.hypot(vector[0], vector[1])
    if length <= 1e-6:
        return 1.0, 0.0
    return vector[0] / length, vector[1] / length


def rotate_vector(vector: tuple[float, float], radians: float) -> tuple[float, float]:
    cos_v = math.cos(radians)
    sin_v = math.sin(radians)
    return vector[0] * cos_v - vector[1] * sin_v, vector[0] * sin_v + vector[1] * cos_v


def cross_2d(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[1] - a[1] * b[0]
