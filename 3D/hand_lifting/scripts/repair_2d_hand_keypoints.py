#!/usr/bin/env python3
"""Structure-aware 2D hand keypoint repair.

This module is separate from the jitter/smoothing preprocessors. It tries to
repair clearly invalid hand joint assignments by rebuilding affected finger
chains from stable per-sequence bone lengths and directions.
"""

from __future__ import annotations

import copy
import math
from dataclasses import asdict, dataclass, field
from statistics import median
from typing import Any


HAND_JOINT_COUNT = 21
HAND_WRIST_INDEX = 0
PALM_INDICES = (0, 5, 9, 13, 17)
FINGER_CHAINS = {
    "thumb": (0, 1, 2, 3, 4),
    "index": (0, 5, 6, 7, 8),
    "middle": (0, 9, 10, 11, 12),
    "ring": (0, 13, 14, 15, 16),
    "pinky": (0, 17, 18, 19, 20),
}
JOINT_TO_CHAIN = {
    joint: chain_name
    for chain_name, chain in FINGER_CHAINS.items()
    for joint in chain[1:]
}
HAND_PARENT = {
    child: parent
    for chain in FINGER_CHAINS.values()
    for parent, child in zip(chain, chain[1:])
}
BODY25_RIGHT_SHOULDER = 2
BODY25_LEFT_SHOULDER = 5


@dataclass(frozen=True)
class HandRepairConfig:
    low_confidence_threshold: float = 0.2
    stable_confidence_threshold: float = 0.35
    bone_min_ratio: float = 0.45
    bone_max_ratio: float = 1.9
    local_deviation_threshold: float = 0.10
    cross_hand_distance_threshold: float = 0.08
    cross_hand_distal_confidence_max: float = 0.65
    max_interpolate_run: int = 3
    thumb_relax_scale: float = 1.35
    min_shoulder_width_px: float = 80.0
    min_angle_deg: float = 12.0
    child_intrusion_threshold: float = 0.035


@dataclass
class HandRepairResult:
    left_hand: list[Any]
    right_hand: list[Any]
    stats: dict[str, Any]
    top_frame_risks: list[dict[str, Any]] = field(default_factory=list)


def repair_2d_hand_keypoints(
    pose_frames: list[Any],
    left_hand_frames: list[Any],
    right_hand_frames: list[Any],
    config: HandRepairConfig | None = None,
) -> HandRepairResult:
    """Repair left/right 2D hand keypoints without mutating inputs."""

    cfg = config or HandRepairConfig()
    left_original = normalize_hand_frames(left_hand_frames)
    right_original = normalize_hand_frames(right_hand_frames)
    scale_px = estimate_scale_px(pose_frames, left_original, right_original, cfg.min_shoulder_width_px)
    left_result = repair_single_hand(left_original, right_original, "left", scale_px, cfg)
    right_result = repair_single_hand(right_original, left_original, "right", scale_px, cfg)
    stats = {
        "method": "hand_keypoint_structure_repair_v1",
        "config": asdict(cfg),
        "scale_px": round(scale_px, 6),
        "left": left_result["stats"],
        "right": right_result["stats"],
        "total_repaired_points": left_result["stats"]["repaired_points"] + right_result["stats"]["repaired_points"],
        "total_repaired_frames": left_result["stats"]["repaired_frames"] + right_result["stats"]["repaired_frames"],
        "total_detected_points": left_result["stats"]["detected_points"] + right_result["stats"]["detected_points"],
        "total_cross_hand_risk_points": (
            left_result["stats"]["cross_hand_risk_points"]
            + right_result["stats"]["cross_hand_risk_points"]
        ),
    }
    top_risks = sorted(
        left_result["top_frame_risks"] + right_result["top_frame_risks"],
        key=lambda item: item["severity"],
        reverse=True,
    )
    return HandRepairResult(
        left_hand=left_result["frames"],
        right_hand=right_result["frames"],
        stats=stats,
        top_frame_risks=top_risks,
    )


def repair_single_hand(
    frames: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    hand: str,
    scale_px: float,
    cfg: HandRepairConfig,
) -> dict[str, Any]:
    original = copy.deepcopy(frames)
    repaired = copy.deepcopy(frames)
    metrics = build_sequence_metrics(original, opposite_frames, scale_px, cfg)
    reasons = detect_invalid_joints(original, opposite_frames, metrics, scale_px, cfg)
    repair_mask = build_repair_mask(reasons)
    repaired_points, repaired_frames, repaired_chains = apply_chain_repairs(
        repaired,
        original,
        repair_mask,
        metrics,
        cfg,
    )
    cross_hand_reverted = revert_repairs_that_reduce_cross_hand_distance(
        repaired,
        original,
        opposite_frames,
        repair_mask,
        scale_px,
        cfg,
    )
    stats = {
        "frame_count": len(frames),
        "detected_points": count_detected(reasons),
        "repaired_points": repaired_points,
        "repaired_frames": repaired_frames,
        "repaired_chains": repaired_chains,
        "cross_hand_reverted_points": cross_hand_reverted,
        "confidence_risk_points": count_reason(reasons, "confidence"),
        "bone_violation_points": count_reason(reasons, "bone"),
        "angle_violation_points": count_reason(reasons, "angle"),
        "chain_order_violation_points": count_reason(reasons, "chain_order"),
        "chain_intrusion_points": count_reason(reasons, "chain_intrusion"),
        "cross_hand_risk_points": count_reason(reasons, "cross_hand"),
        "local_deviation_points": count_reason(reasons, "local"),
        "changed_points": count_changed_points(original, repaired),
        "max_joint_jump_before": round(max_joint_jump(original), 6),
        "max_joint_jump_after": round(max_joint_jump(repaired), 6),
        "bone_max_ratio_before": round(max_bone_ratio(original, metrics["bone_lengths"]), 6),
        "bone_max_ratio_after": round(max_bone_ratio(repaired, metrics["bone_lengths"]), 6),
        "joint_repair_counts": {
            str(joint): sum(1 for frame in repair_mask if frame[joint])
            for joint in range(1, HAND_JOINT_COUNT)
        },
    }
    return {
        "frames": repaired,
        "stats": stats,
        "top_frame_risks": build_frame_risks(reasons, original, hand),
    }


def build_sequence_metrics(
    frames: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    scale_px: float,
    cfg: HandRepairConfig,
) -> dict[str, Any]:
    bone_lengths = median_bone_lengths(frames)
    default_lengths = fallback_bone_lengths(frames, scale_px)
    for joint, length in default_lengths.items():
        bone_lengths.setdefault(joint, length)
    raw_reasons = detect_geometry_reasons(frames, opposite_frames, bone_lengths, scale_px, cfg)
    stable_frames = [
        frame_index
        for frame_index, frame in enumerate(frames)
        if is_stable_frame(frame, raw_reasons[frame_index], cfg)
    ]
    bone_dirs = median_bone_directions(frames, stable_frames)
    palm_dirs = median_finger_directions(frames, stable_frames)
    return {
        "bone_lengths": bone_lengths,
        "stable_frames": stable_frames,
        "bone_dirs": bone_dirs,
        "palm_dirs": palm_dirs,
    }


def detect_invalid_joints(
    frames: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    metrics: dict[str, Any],
    scale_px: float,
    cfg: HandRepairConfig,
) -> list[list[set[str]]]:
    reasons = detect_geometry_reasons(frames, opposite_frames, metrics["bone_lengths"], scale_px, cfg)
    local_frames = local_hand_points(frames)
    local_threshold = max(12.0, cfg.local_deviation_threshold * scale_px)
    for joint in range(1, HAND_JOINT_COUNT):
        for frame_index in range(len(frames)):
            local_point = local_frames[frame_index][joint]
            if local_point is None:
                continue
            stable_ref = stable_window_median(local_frames, metrics["stable_frames"], joint, frame_index)
            if stable_ref and distance(local_point, stable_ref) > local_threshold:
                reasons[frame_index][joint].add("local")
    return reasons


def detect_geometry_reasons(
    frames: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    bone_lengths: dict[int, float],
    scale_px: float,
    cfg: HandRepairConfig,
) -> list[list[set[str]]]:
    reasons: list[list[set[str]]] = [
        [set() for _ in range(HAND_JOINT_COUNT)] for _ in frames
    ]
    cross_threshold = max(12.0, cfg.cross_hand_distance_threshold * scale_px)
    distal_cross_threshold = max(18.0, cross_threshold * 1.5)
    intrusion_threshold = max(10.0, cfg.child_intrusion_threshold * scale_px)
    for frame_index, frame in enumerate(frames):
        for joint in range(1, HAND_JOINT_COUNT):
            if confidence(frame[joint]) < cfg.low_confidence_threshold:
                reasons[frame_index][joint].add("confidence")
            parent = HAND_PARENT[joint]
            base = point_xy(frame[parent])
            child = point_xy(frame[joint])
            median_length = bone_lengths.get(joint)
            if base and child and median_length:
                length = distance(base, child)
                min_ratio = cfg.bone_min_ratio / thumb_relax(joint, cfg)
                max_ratio = cfg.bone_max_ratio * thumb_relax(joint, cfg)
                if length < median_length * min_ratio or length > median_length * max_ratio:
                    reasons[frame_index][joint].add("bone")

        for chain_name, chain in FINGER_CHAINS.items():
            for parent, joint, child in zip(chain, chain[1:], chain[2:]):
                parent_xy = point_xy(frame[parent])
                joint_xy = point_xy(frame[joint])
                child_xy = point_xy(frame[child])
                if not parent_xy or not joint_xy or not child_xy:
                    continue
                angle = angle_between(
                    (parent_xy[0] - joint_xy[0], parent_xy[1] - joint_xy[1]),
                    (child_xy[0] - joint_xy[0], child_xy[1] - joint_xy[1]),
                )
                relax = cfg.thumb_relax_scale if chain_name == "thumb" else 1.0
                min_angle = math.radians(cfg.min_angle_deg / relax)
                if angle < min_angle:
                    reasons[frame_index][joint].add("angle")
                    reasons[frame_index][child].add("angle")
                prev_vec = (joint_xy[0] - parent_xy[0], joint_xy[1] - parent_xy[1])
                next_vec = (child_xy[0] - joint_xy[0], child_xy[1] - joint_xy[1])
                if dot(prev_vec, next_vec) < -0.75 * vector_length(prev_vec) * vector_length(next_vec):
                    reasons[frame_index][child].add("chain_order")

            for joint in chain[2:]:
                point = point_xy(frame[joint])
                if not point:
                    continue
                for other_name, other_chain in FINGER_CHAINS.items():
                    if other_name == chain_name:
                        continue
                    for a, b in zip(other_chain[1:], other_chain[2:]):
                        a_xy = point_xy(frame[a])
                        b_xy = point_xy(frame[b])
                        if a_xy and b_xy and distance_point_to_segment(point, a_xy, b_xy) < intrusion_threshold:
                            reasons[frame_index][joint].add("chain_intrusion")
                            break

        if frame_index < len(opposite_frames):
            opposite_points = [
                point_xy(point)
                for point in opposite_frames[frame_index]
                if confidence(point) >= cfg.low_confidence_threshold
            ]
            opposite_points = [point for point in opposite_points if point is not None]
            if opposite_points:
                for joint in range(1, HAND_JOINT_COUNT):
                    xy = point_xy(frame[joint])
                    if not xy:
                        continue
                    near_opposite = min(distance(xy, other) for other in opposite_points) < cross_threshold
                    distal_joint = joint not in (1, 5, 9, 13, 17)
                    near_opposite_distal = min(distance(xy, other) for other in opposite_points) < distal_cross_threshold
                    if (
                        near_opposite_distal
                        and distal_joint
                        and confidence(frame[joint]) <= cfg.cross_hand_distal_confidence_max
                    ):
                        reasons[frame_index][joint].add("cross_hand_distal")
                    structural_reasons = reasons[frame_index][joint] - {"confidence", "local", "cross_hand_distal"}
                    if near_opposite and structural_reasons:
                        reasons[frame_index][joint].add("cross_hand")
    return reasons


def build_repair_mask(reasons: list[list[set[str]]]) -> list[list[bool]]:
    strong = {"confidence", "bone", "chain_order", "cross_hand", "cross_hand_distal"}
    mask: list[list[bool]] = []
    for frame in reasons:
        frame_mask = [False] * HAND_JOINT_COUNT
        for joint in range(1, HAND_JOINT_COUNT):
            if frame[joint] & strong:
                frame_mask[joint] = True
        mask.append(frame_mask)
    return mask


def apply_chain_repairs(
    repaired: list[list[list[float]]],
    original: list[list[list[float]]],
    repair_mask: list[list[bool]],
    metrics: dict[str, Any],
    cfg: HandRepairConfig,
) -> tuple[int, int, int]:
    repaired_points = 0
    repaired_frames: set[int] = set()
    repaired_chains = 0
    for frame_index, frame in enumerate(repaired):
        for chain_name, chain in FINGER_CHAINS.items():
            broken_positions = [pos for pos, joint in enumerate(chain[1:], start=1) if repair_mask[frame_index][joint]]
            if not broken_positions:
                continue
            start_pos = min(broken_positions)
            parent_joint = chain[start_pos - 1]
            if point_xy(frame[parent_joint]) is None:
                continue
            repaired_chains += 1
            repaired_frames.add(frame_index)
            for pos in range(start_pos, len(chain)):
                joint = chain[pos]
                parent = chain[pos - 1]
                parent_xy = point_xy(frame[parent])
                if parent_xy is None:
                    break
                direction = choose_bone_direction(
                    original,
                    frame_index,
                    parent,
                    joint,
                    metrics,
                )
                length = metrics["bone_lengths"].get(joint)
                if not length or length <= 1e-6:
                    current = point_xy(original[frame_index][joint])
                    length = distance(parent_xy, current) if current else 12.0
                frame[joint][0] = parent_xy[0] + direction[0] * length
                frame[joint][1] = parent_xy[1] + direction[1] * length
                repaired_points += 1
                if pos == start_pos and not any(repair_mask[frame_index][child] for child in chain[pos + 1:]):
                    break
    return repaired_points, len(repaired_frames), repaired_chains


def revert_repairs_that_reduce_cross_hand_distance(
    repaired: list[list[list[float]]],
    original: list[list[list[float]]],
    opposite_frames: list[list[list[float]]],
    repair_mask: list[list[bool]],
    scale_px: float,
    cfg: HandRepairConfig,
) -> int:
    """Undo repairs that pull a joint further into the opposite hand."""

    threshold = max(12.0, cfg.cross_hand_distance_threshold * scale_px * 1.5)
    reverted = 0
    frame_count = min(len(repaired), len(original), len(opposite_frames), len(repair_mask))
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
            if not repair_mask[frame_index][joint]:
                continue
            original_xy = point_xy(original[frame_index][joint])
            repaired_xy = point_xy(repaired[frame_index][joint])
            if not original_xy or not repaired_xy:
                continue
            original_nearest = min(distance(original_xy, opposite) for opposite in opposite_points)
            repaired_nearest = min(distance(repaired_xy, opposite) for opposite in opposite_points)
            if original_nearest <= threshold and repaired_nearest + 1e-6 < original_nearest:
                repaired[frame_index][joint][0] = original[frame_index][joint][0]
                repaired[frame_index][joint][1] = original[frame_index][joint][1]
                reverted += 1
    return reverted


def choose_bone_direction(
    frames: list[list[list[float]]],
    frame_index: int,
    parent: int,
    joint: int,
    metrics: dict[str, Any],
) -> tuple[float, float]:
    prev_dir = nearest_stable_bone_direction(frames, metrics["stable_frames"], parent, joint, frame_index, -1)
    next_dir = nearest_stable_bone_direction(frames, metrics["stable_frames"], parent, joint, frame_index, 1)
    if prev_dir and next_dir:
        return normalize((prev_dir[0] + next_dir[0], prev_dir[1] + next_dir[1])) or prev_dir
    if prev_dir:
        return prev_dir
    if next_dir:
        return next_dir
    current_parent = point_xy(frames[frame_index][parent])
    current_joint = point_xy(frames[frame_index][joint])
    if current_parent and current_joint:
        direction = normalize((current_joint[0] - current_parent[0], current_joint[1] - current_parent[1]))
        if direction:
            return direction
    median_dir = metrics["bone_dirs"].get(joint)
    if median_dir:
        return median_dir
    chain_name = JOINT_TO_CHAIN.get(joint)
    if chain_name and chain_name in metrics["palm_dirs"]:
        return metrics["palm_dirs"][chain_name]
    return (0.0, -1.0)


def nearest_stable_bone_direction(
    frames: list[list[list[float]]],
    stable_frames: list[int],
    parent: int,
    joint: int,
    frame_index: int,
    step: int,
) -> tuple[float, float] | None:
    candidates = [idx for idx in stable_frames if (idx < frame_index if step < 0 else idx > frame_index)]
    candidates.sort(key=lambda idx: abs(idx - frame_index))
    for idx in candidates[:8]:
        parent_xy = point_xy(frames[idx][parent])
        joint_xy = point_xy(frames[idx][joint])
        if parent_xy and joint_xy:
            direction = normalize((joint_xy[0] - parent_xy[0], joint_xy[1] - parent_xy[1]))
            if direction:
                return direction
    return None


def is_stable_frame(frame: list[list[float]], reasons: list[set[str]], cfg: HandRepairConfig) -> bool:
    hand_conf = [
        confidence(frame[joint])
        for joint in range(1, HAND_JOINT_COUNT)
    ]
    if not hand_conf or median(hand_conf) < cfg.stable_confidence_threshold:
        return False
    return all(not reasons[joint] for joint in range(1, HAND_JOINT_COUNT))


def normalize_hand_frames(frames: list[Any]) -> list[list[list[float]]]:
    normalized: list[list[list[float]]] = []
    for frame in frames:
        normalized_frame: list[list[float]] = []
        if not isinstance(frame, list):
            frame = []
        for joint in range(HAND_JOINT_COUNT):
            point = frame[joint] if joint < len(frame) and isinstance(frame[joint], list) else []
            normalized_frame.append([
                finite_float(point[0] if len(point) > 0 else 0.0),
                finite_float(point[1] if len(point) > 1 else 0.0),
                finite_float(point[2] if len(point) > 2 else 0.0),
            ])
        normalized.append(normalized_frame)
    return normalized


def estimate_scale_px(
    pose_frames: list[Any],
    left_frames: list[list[list[float]]],
    right_frames: list[list[list[float]]],
    minimum: float,
) -> float:
    widths: list[float] = []
    for frame in pose_frames:
        if isinstance(frame, list) and len(frame) > max(BODY25_RIGHT_SHOULDER, BODY25_LEFT_SHOULDER):
            right = point_xy(frame[BODY25_RIGHT_SHOULDER])
            left = point_xy(frame[BODY25_LEFT_SHOULDER])
            if right and left:
                widths.append(distance(right, left))
    if widths:
        return max(minimum, median(widths))
    hand_widths: list[float] = []
    for frames in (left_frames, right_frames):
        for frame in frames:
            points = [point_xy(frame[index]) for index in (5, 17)]
            if points[0] and points[1]:
                hand_widths.append(distance(points[0], points[1]) * 3.5)
    return max(minimum, median(hand_widths) if hand_widths else minimum)


def median_bone_lengths(frames: list[list[list[float]]]) -> dict[int, float]:
    lengths: dict[int, list[float]] = {joint: [] for joint in HAND_PARENT}
    for frame in frames:
        for joint, parent in HAND_PARENT.items():
            if confidence(frame[joint]) < 0.2 or confidence(frame[parent]) < 0.2:
                continue
            parent_xy = point_xy(frame[parent])
            child_xy = point_xy(frame[joint])
            if parent_xy and child_xy:
                length = distance(parent_xy, child_xy)
                if length > 1e-6:
                    lengths[joint].append(length)
    return {joint: median(values) for joint, values in lengths.items() if values}


def fallback_bone_lengths(frames: list[list[list[float]]], scale_px: float) -> dict[int, float]:
    hand_widths: list[float] = []
    for frame in frames:
        a = point_xy(frame[5])
        b = point_xy(frame[17])
        if a and b:
            hand_widths.append(distance(a, b))
    width = median(hand_widths) if hand_widths else scale_px * 0.25
    return {joint: max(6.0, width * 0.23) for joint in HAND_PARENT}


def median_bone_directions(
    frames: list[list[list[float]]],
    stable_frames: list[int],
) -> dict[int, tuple[float, float]]:
    directions: dict[int, list[tuple[float, float]]] = {joint: [] for joint in HAND_PARENT}
    indices = stable_frames or list(range(len(frames)))
    for frame_index in indices:
        frame = frames[frame_index]
        for joint, parent in HAND_PARENT.items():
            parent_xy = point_xy(frame[parent])
            child_xy = point_xy(frame[joint])
            if parent_xy and child_xy:
                direction = normalize((child_xy[0] - parent_xy[0], child_xy[1] - parent_xy[1]))
                if direction:
                    directions[joint].append(direction)
    return {
        joint: normalize((median([d[0] for d in values]), median([d[1] for d in values]))) or (0.0, -1.0)
        for joint, values in directions.items()
        if values
    }


def median_finger_directions(
    frames: list[list[list[float]]],
    stable_frames: list[int],
) -> dict[str, tuple[float, float]]:
    result: dict[str, tuple[float, float]] = {}
    indices = stable_frames or list(range(len(frames)))
    for chain_name, chain in FINGER_CHAINS.items():
        values: list[tuple[float, float]] = []
        for frame_index in indices:
            frame = frames[frame_index]
            palm = palm_center(frame)
            tip = point_xy(frame[chain[-1]])
            if palm and tip:
                direction = normalize((tip[0] - palm[0], tip[1] - palm[1]))
                if direction:
                    values.append(direction)
        if values:
            result[chain_name] = normalize((median([d[0] for d in values]), median([d[1] for d in values]))) or (0.0, -1.0)
    return result


def local_hand_points(frames: list[list[list[float]]]) -> list[list[tuple[float, float] | None]]:
    local_frames: list[list[tuple[float, float] | None]] = []
    for frame in frames:
        center = palm_center(frame)
        local_frame: list[tuple[float, float] | None] = []
        for point in frame:
            xy = point_xy(point)
            if xy is None or center is None:
                local_frame.append(None)
            else:
                local_frame.append((xy[0] - center[0], xy[1] - center[1]))
        local_frames.append(local_frame)
    return local_frames


def stable_window_median(
    local_frames: list[list[tuple[float, float] | None]],
    stable_frames: list[int],
    joint: int,
    frame_index: int,
    radius: int = 5,
) -> tuple[float, float] | None:
    candidates: list[tuple[float, float]] = []
    preferred = [idx for idx in stable_frames if abs(idx - frame_index) <= radius]
    for idx in preferred or stable_frames:
        point = local_frames[idx][joint]
        if point is not None:
            candidates.append(point)
        if len(candidates) >= 9:
            break
    if not candidates:
        return None
    return median([point[0] for point in candidates]), median([point[1] for point in candidates])


def palm_center(frame: list[list[float]]) -> tuple[float, float] | None:
    points = [
        point_xy(frame[index])
        for index in PALM_INDICES
        if index < len(frame) and confidence(frame[index]) > 0.01
    ]
    valid = [point for point in points if point is not None]
    if not valid:
        return None
    return median([point[0] for point in valid]), median([point[1] for point in valid])


def max_joint_jump(frames: list[list[list[float]]]) -> float:
    jumps: list[float] = []
    for frame_index in range(1, len(frames)):
        for joint in range(1, HAND_JOINT_COUNT):
            current = point_xy(frames[frame_index][joint])
            previous = point_xy(frames[frame_index - 1][joint])
            if current and previous:
                jumps.append(distance(previous, current))
    return max(jumps) if jumps else 0.0


def max_bone_ratio(frames: list[list[list[float]]], medians: dict[int, float]) -> float:
    ratios: list[float] = []
    for frame in frames:
        for joint, parent in HAND_PARENT.items():
            median_length = medians.get(joint)
            parent_xy = point_xy(frame[parent])
            child_xy = point_xy(frame[joint])
            if median_length and parent_xy and child_xy:
                length = max(1e-6, distance(parent_xy, child_xy))
                ratios.append(max(length / median_length, median_length / length))
    return max(ratios) if ratios else 0.0


def build_frame_risks(
    reasons: list[list[set[str]]],
    frames: list[list[list[float]]],
    hand: str,
) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    for frame_index, frame in enumerate(reasons):
        for joint, joint_reasons in enumerate(frame):
            if joint == HAND_WRIST_INDEX or not joint_reasons:
                continue
            risks.append({
                "hand": hand,
                "frame_index": frame_index,
                "joint": joint,
                "reasons": sorted(joint_reasons),
                "severity": len(joint_reasons),
                "confidence": round(confidence(frames[frame_index][joint]), 6),
                "chain": JOINT_TO_CHAIN.get(joint),
            })
    return sorted(risks, key=lambda item: item["severity"], reverse=True)


def count_changed_points(before: list[list[list[float]]], after: list[list[list[float]]]) -> int:
    changed = 0
    for before_frame, after_frame in zip(before, after, strict=True):
        for joint in range(1, HAND_JOINT_COUNT):
            if abs(before_frame[joint][0] - after_frame[joint][0]) > 1e-6 or abs(before_frame[joint][1] - after_frame[joint][1]) > 1e-6:
                changed += 1
    return changed


def count_detected(reasons: list[list[set[str]]]) -> int:
    return sum(1 for frame in reasons for joint in frame[1:] if joint)


def count_reason(reasons: list[list[set[str]]], reason: str) -> int:
    return sum(1 for frame in reasons for joint in frame[1:] if reason in joint)


def thumb_relax(joint: int, cfg: HandRepairConfig) -> float:
    return cfg.thumb_relax_scale if JOINT_TO_CHAIN.get(joint) == "thumb" else 1.0


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
    return (x, y) if math.isfinite(x) and math.isfinite(y) else None


def confidence(point: Any) -> float:
    if not isinstance(point, list) or len(point) < 3:
        return 0.0
    return finite_float(point[2])


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def vector_length(vector: tuple[float, float]) -> float:
    return math.hypot(vector[0], vector[1])


def normalize(vector: tuple[float, float]) -> tuple[float, float] | None:
    length = vector_length(vector)
    if length <= 1e-6:
        return None
    return vector[0] / length, vector[1] / length


def dot(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1]


def angle_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    a_len = vector_length(a)
    b_len = vector_length(b)
    if a_len <= 1e-6 or b_len <= 1e-6:
        return 0.0
    cos_value = max(-1.0, min(1.0, dot(a, b) / (a_len * b_len)))
    return math.acos(cos_value)


def distance_point_to_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    sx, sy = start
    ex, ey = end
    px, py = point
    vx = ex - sx
    vy = ey - sy
    length_sq = vx * vx + vy * vy
    if length_sq <= 1e-6:
        return distance(point, start)
    t = max(0.0, min(1.0, ((px - sx) * vx + (py - sy) * vy) / length_sq))
    projection = (sx + t * vx, sy + t * vy)
    return distance(point, projection)
