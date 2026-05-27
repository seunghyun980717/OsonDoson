#!/usr/bin/env python3
"""Motion-outlier + IK postprocess for v0.5 hand-lifting viewer QA files.

This script reads word JSON files with ``sample.keypoints.estimated_3d`` and
writes a copy that adds ``sample.keypoints.postprocessed_3d``. It keeps the
original estimated_3d unchanged. The v3 correction first smooths per-joint 3D
motion outliers relative to palm motion, then applies the v2 chain-relative IK
constraints and final bone length cleanup.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]

HAND_JOINT_COUNT = 21
FINGER_CHAINS = {
    "thumb": (0, 1, 2, 3, 4),
    "index": (0, 5, 6, 7, 8),
    "middle": (0, 9, 10, 11, 12),
    "ring": (0, 13, 14, 15, 16),
    "pinky": (0, 17, 18, 19, 20),
}
HAND_BONES = tuple((chain[index], chain[index + 1]) for chain in FINGER_CHAINS.values() for index in range(len(chain) - 1))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", type=Path, default=THREE_D_ROOT / "data" / "words")
    parser.add_argument("--include-pattern", dest="include_patterns", action="append")
    parser.add_argument("--output-prefix", default="post_v0_5_motion_ik_QA_full")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--write-copy", action="store_true", default=True)
    parser.add_argument("--in-place", dest="write_copy", action="store_false")
    parser.add_argument("--overwrite", action="store_true", default=True)
    parser.add_argument("--no-overwrite", dest="overwrite", action="store_false")
    parser.add_argument("--summary-output", type=Path)
    parser.add_argument("--bone-min-ratio", type=float, default=0.75)
    parser.add_argument("--bone-max-ratio", type=float, default=1.35)
    parser.add_argument("--mcp-min-angle-deg", type=float, default=35.0)
    parser.add_argument("--pip-min-angle-deg", type=float, default=25.0)
    parser.add_argument("--dip-min-angle-deg", type=float, default=20.0)
    parser.add_argument("--mcp-sidebend-limit", type=float, default=0.75)
    parser.add_argument("--pip-sidebend-limit", type=float, default=0.35)
    parser.add_argument("--dip-sidebend-limit", type=float, default=0.30)
    parser.add_argument("--flexion-plane-strength", type=float, default=0.45)
    parser.add_argument("--low-confidence-threshold", type=float, default=0.2)
    parser.add_argument("--mid-confidence-threshold", type=float, default=0.6)
    parser.add_argument("--low-confidence-blend", type=float, default=0.65)
    parser.add_argument("--mid-confidence-blend", type=float, default=0.35)
    parser.add_argument("--basis-smooth-alpha", type=float, default=0.70)
    parser.add_argument("--thumb-angle-scale", type=float, default=1.35)
    parser.add_argument("--thumb-sidebend-scale", type=float, default=1.5)
    parser.add_argument("--finger-motion-ratio-threshold", type=float, default=3.0)
    parser.add_argument("--finger-motion-absolute-threshold", type=float, default=0.035)
    parser.add_argument("--tip-motion-absolute-threshold", type=float, default=0.045)
    parser.add_argument("--finger-local-motion-threshold", type=float, default=0.018)
    parser.add_argument("--tip-local-motion-threshold", type=float, default=0.024)
    parser.add_argument("--motion-blend", type=float, default=0.75)
    parser.add_argument("--motion-clamp-strength", type=float, default=0.85)
    return parser.parse_args()


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def values_for(block: dict[str, Any], name: str) -> list[Any]:
    values = ((block or {}).get(name) or {}).get("values")
    return values if isinstance(values, list) else []


def shape_block(values: list[Any], point_count: int, components: int = 4) -> dict[str, Any]:
    return {"shape": [len(values), point_count, components], "values": values}


def vec_sub(a: list[float], b: list[float]) -> list[float]:
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def vec_add(a: list[float], b: list[float]) -> list[float]:
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def vec_mul(a: list[float], scale: float) -> list[float]:
    return [a[0] * scale, a[1] * scale, a[2] * scale]


def dot(a: list[float], b: list[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: list[float], b: list[float]) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def norm(a: list[float]) -> float:
    return math.sqrt(max(0.0, dot(a, a)))


def normalize(a: list[float]) -> list[float] | None:
    length = norm(a)
    if length <= 1e-8:
        return None
    return [a[0] / length, a[1] / length, a[2] / length]


def blend_vec(a: list[float], b: list[float], b_weight: float) -> list[float]:
    return [a[axis] * (1.0 - b_weight) + b[axis] * b_weight for axis in range(3)]


def clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def point_xyz(frame: list[Any], index: int) -> list[float] | None:
    if index >= len(frame) or not isinstance(frame[index], list) or len(frame[index]) < 3:
        return None
    return [finite_float(frame[index][0]), finite_float(frame[index][1]), finite_float(frame[index][2])]


def set_xyz(frame: list[Any], index: int, xyz: list[float]) -> None:
    if index < len(frame) and isinstance(frame[index], list) and len(frame[index]) >= 3:
        frame[index][0] = round(xyz[0], 6)
        frame[index][1] = round(xyz[1], 6)
        frame[index][2] = round(xyz[2], 6)


def hand_confidence(image_2d: dict[str, Any], hand_name: str, frame_index: int) -> float:
    frames = values_for(image_2d, hand_name)
    if frame_index >= len(frames) or not isinstance(frames[frame_index], list):
        return 0.0
    confs = [
        finite_float(point[2], 0.0)
        for point in frames[frame_index]
        if isinstance(point, list) and len(point) >= 3 and finite_float(point[2], 0.0) > 0
    ]
    return sum(confs) / len(confs) if confs else 0.0


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) * 0.5


def bone_references(frames: list[list[Any]]) -> dict[tuple[int, int], float]:
    references: dict[tuple[int, int], float] = {}
    for bone in HAND_BONES:
        lengths = []
        for frame in frames:
            parent = point_xyz(frame, bone[0])
            child = point_xyz(frame, bone[1])
            if parent is None or child is None:
                continue
            length = norm(vec_sub(child, parent))
            if length > 1e-8:
                lengths.append(length)
        reference = median(lengths)
        if reference:
            references[bone] = reference
    return references


def palm_basis(frame: list[Any]) -> dict[str, list[float]] | None:
    wrist = point_xyz(frame, 0)
    index_mcp = point_xyz(frame, 5)
    middle_mcp = point_xyz(frame, 9)
    pinky_mcp = point_xyz(frame, 17)
    if wrist is None or index_mcp is None or middle_mcp is None or pinky_mcp is None:
        return None
    lateral = normalize(vec_sub(pinky_mcp, index_mcp))
    forward = normalize(vec_sub(middle_mcp, wrist))
    if lateral is None or forward is None:
        return None
    normal = normalize(cross(forward, lateral))
    if normal is None:
        return None
    lateral = normalize(cross(normal, forward))
    if lateral is None:
        return None
    return {"forward": forward, "lateral": lateral, "normal": normal}


def smooth_basis_sequence(frames: list[list[Any]], alpha: float) -> list[dict[str, list[float]] | None]:
    smoothed: list[dict[str, list[float]] | None] = []
    previous: dict[str, list[float]] | None = None
    for frame in frames:
        current = palm_basis(frame)
        if current is None:
            smoothed.append(previous)
            continue
        if previous is not None:
            current = {
                key: normalize(blend_vec(current[key], previous[key], 1.0 - alpha)) or current[key]
                for key in ("forward", "lateral", "normal")
            }
        smoothed.append(current)
        previous = current
    return smoothed


def palm_center(frame: list[Any]) -> list[float] | None:
    points = [point_xyz(frame, index) for index in (0, 5, 9, 13, 17)]
    valid = [point for point in points if point is not None]
    if not valid:
        return None
    return [
        sum(point[axis] for point in valid) / len(valid)
        for axis in range(3)
    ]


def motion_joint_indices() -> set[int]:
    # Keep wrist/MCP movement intact; smooth only internal finger joints and tips.
    return {index for chain in FINGER_CHAINS.values() for index in chain[2:]}


def tip_joint_indices() -> set[int]:
    return {chain[-1] for chain in FINGER_CHAINS.values()}


def motion_parent_map() -> dict[int, int]:
    parents: dict[int, int] = {}
    for chain in FINGER_CHAINS.values():
        for index in range(1, len(chain)):
            parents[chain[index]] = chain[index - 1]
    return parents


def parent_relative_motion(
    frames: list[list[Any]],
    frame_index: int,
    joint_index: int,
    parent_index: int,
) -> float | None:
    current = point_xyz(frames[frame_index], joint_index)
    previous = point_xyz(frames[frame_index - 1], joint_index)
    current_parent = point_xyz(frames[frame_index], parent_index)
    previous_parent = point_xyz(frames[frame_index - 1], parent_index)
    if current is None or previous is None or current_parent is None or previous_parent is None:
        return None
    current_relative = vec_sub(current, current_parent)
    previous_relative = vec_sub(previous, previous_parent)
    return norm(vec_sub(current_relative, previous_relative))


def parent_relative_interpolation_target(
    frames: list[list[Any]],
    frame_index: int,
    joint_index: int,
    parent_index: int,
) -> list[float] | None:
    current_parent = point_xyz(frames[frame_index], parent_index)
    previous = point_xyz(frames[frame_index - 1], joint_index)
    previous_parent = point_xyz(frames[frame_index - 1], parent_index)
    if current_parent is None or previous is None or previous_parent is None:
        return None

    previous_relative = vec_sub(previous, previous_parent)
    if frame_index + 1 < len(frames):
        next_point = point_xyz(frames[frame_index + 1], joint_index)
        next_parent = point_xyz(frames[frame_index + 1], parent_index)
        if next_point is not None and next_parent is not None:
            next_relative = vec_sub(next_point, next_parent)
            target_relative = [
                (previous_relative[axis] + next_relative[axis]) * 0.5
                for axis in range(3)
            ]
            return vec_add(current_parent, target_relative)

    return vec_add(current_parent, previous_relative)


def interpolate_motion_outliers(frames: list[list[Any]], args: argparse.Namespace) -> dict[str, int]:
    counts = {"motion_outlier": 0, "motion_interpolate": 0}
    if len(frames) < 2:
        return counts

    joint_indices = motion_joint_indices()
    tip_indices = tip_joint_indices()
    parents = motion_parent_map()
    original = copy.deepcopy(frames)
    for frame_index in range(1, len(frames)):
        current_palm = palm_center(original[frame_index])
        previous_palm = palm_center(original[frame_index - 1])
        palm_move = norm(vec_sub(current_palm, previous_palm)) if current_palm is not None and previous_palm is not None else 0.0
        relative_threshold = max(args.finger_motion_absolute_threshold, palm_move * args.finger_motion_ratio_threshold)

        for joint_index in joint_indices:
            current = point_xyz(original[frame_index], joint_index)
            previous = point_xyz(original[frame_index - 1], joint_index)
            if current is None or previous is None:
                continue
            joint_move = norm(vec_sub(current, previous))
            absolute_threshold = args.tip_motion_absolute_threshold if joint_index in tip_indices else args.finger_motion_absolute_threshold
            global_threshold = max(absolute_threshold, relative_threshold)

            parent_index = parents.get(joint_index)
            local_move = (
                parent_relative_motion(original, frame_index, joint_index, parent_index)
                if parent_index is not None
                else None
            )
            local_threshold = args.tip_local_motion_threshold if joint_index in tip_indices else args.finger_local_motion_threshold
            is_global_outlier = joint_move > global_threshold
            is_local_outlier = local_move is not None and local_move > local_threshold
            if not is_global_outlier and not is_local_outlier:
                continue

            counts["motion_outlier"] += 1
            next_point = point_xyz(original[frame_index + 1], joint_index) if frame_index + 1 < len(original) else None
            if next_point is not None:
                target = (
                    parent_relative_interpolation_target(original, frame_index, joint_index, parent_index)
                    if parent_index is not None
                    else None
                )
                if target is None:
                    target = [(previous[axis] + next_point[axis]) * 0.5 for axis in range(3)]
                corrected = blend_vec(current, target, clamp(args.motion_blend, 0.0, 1.0))
                counts["motion_interpolate"] += 1
            else:
                target = (
                    parent_relative_interpolation_target(original, frame_index, joint_index, parent_index)
                    if parent_index is not None
                    else None
                )
                if target is not None:
                    corrected = blend_vec(current, target, clamp(args.motion_clamp_strength, 0.0, 1.0))
                else:
                    direction = normalize(vec_sub(current, previous))
                    if direction is None:
                        continue
                    clamped = vec_add(previous, vec_mul(direction, global_threshold))
                    corrected = blend_vec(current, clamped, clamp(args.motion_clamp_strength, 0.0, 1.0))
            set_xyz(frames[frame_index], joint_index, corrected)

    return counts


def temporal_blend(frames: list[list[Any]], confidences: list[float], args: argparse.Namespace) -> int:
    changed = 0
    for frame_index in range(1, len(frames)):
        confidence = confidences[frame_index] if frame_index < len(confidences) else 0.0
        if confidence < args.low_confidence_threshold:
            weight = args.low_confidence_blend
        elif confidence < args.mid_confidence_threshold:
            weight = args.mid_confidence_blend
        else:
            continue
        for joint_index in range(min(len(frames[frame_index]), len(frames[frame_index - 1]))):
            current = point_xyz(frames[frame_index], joint_index)
            previous = point_xyz(frames[frame_index - 1], joint_index)
            if current is None or previous is None:
                continue
            set_xyz(frames[frame_index], joint_index, blend_vec(current, previous, weight))
            changed += 1
    return changed


def angle_deg(a: list[float], b: list[float]) -> float | None:
    na = normalize(a)
    nb = normalize(b)
    if na is None or nb is None:
        return None
    value = clamp(dot(na, nb), -1.0, 1.0)
    return math.degrees(math.acos(value))


def move_descendants(frame: list[Any], chain: tuple[int, ...], child_index: int, delta: list[float]) -> None:
    try:
        start = chain.index(child_index) + 1
    except ValueError:
        return
    for index in chain[start:]:
        point = point_xyz(frame, index)
        if point is not None:
            set_xyz(frame, index, vec_add(point, delta))


def min_angle_for(level: int, is_thumb: bool, args: argparse.Namespace) -> float:
    base = (args.mcp_min_angle_deg, args.pip_min_angle_deg, args.dip_min_angle_deg)[level]
    return base * args.thumb_angle_scale if is_thumb else base


def sidebend_limit_for(level: int, is_thumb: bool, args: argparse.Namespace) -> float:
    base = (args.mcp_sidebend_limit, args.pip_sidebend_limit, args.dip_sidebend_limit)[level]
    return min(0.95, base * args.thumb_sidebend_scale) if is_thumb else base


def straighten_if_too_folded(
    direction: list[float],
    toward_parent: list[float],
    angle: float | None,
    min_angle: float,
) -> tuple[list[float], bool]:
    if angle is None or angle >= min_angle:
        return direction, False
    away_from_parent = normalize(vec_mul(toward_parent, -1.0))
    if away_from_parent is None:
        return direction, False
    strength = clamp((min_angle - angle) / max(min_angle, 1.0), 0.0, 0.75)
    corrected = normalize(blend_vec(direction, away_from_parent, strength))
    return (corrected or direction), corrected is not None


def constrain_to_flexion_plane(
    direction: list[float],
    previous_axis: list[float],
    basis: dict[str, list[float]] | None,
    sidebend_limit: float,
    strength: float,
) -> tuple[list[float], bool]:
    if basis is None:
        return direction, False
    plane_side = normalize(cross(previous_axis, basis["normal"]))
    if plane_side is None:
        plane_side = basis["lateral"]
    side_component = dot(direction, plane_side)
    if abs(side_component) <= sidebend_limit:
        return direction, False

    limited_side = sidebend_limit if side_component > 0 else -sidebend_limit
    in_plane = vec_sub(direction, vec_mul(plane_side, side_component))
    in_plane_dir = normalize(in_plane)
    if in_plane_dir is None:
        return direction, False
    in_plane_scale = math.sqrt(max(0.0, 1.0 - limited_side * limited_side))
    clamped = normalize(vec_add(vec_mul(in_plane_dir, in_plane_scale), vec_mul(plane_side, limited_side)))
    if clamped is None:
        return direction, False
    corrected = normalize(blend_vec(direction, clamped, clamp(strength, 0.0, 1.0)))
    return (corrected or direction), corrected is not None


def apply_chain_ik(
    frames: list[list[Any]],
    bases: list[dict[str, list[float]] | None],
    references: dict[tuple[int, int], float],
    args: argparse.Namespace,
) -> dict[str, int]:
    counts = {"angle": 0, "sidebend": 0, "torsion": 0}
    for frame_index, frame in enumerate(frames):
        basis = bases[frame_index] if frame_index < len(bases) else None
        for finger_name, chain in FINGER_CHAINS.items():
            is_thumb = finger_name == "thumb"
            for level in range(3):
                parent_index = chain[level]
                joint_index = chain[level + 1]
                child_index = chain[level + 2]
                parent = point_xyz(frame, parent_index)
                joint = point_xyz(frame, joint_index)
                child = point_xyz(frame, child_index)
                if parent is None or joint is None or child is None:
                    continue

                toward_parent = vec_sub(parent, joint)
                toward_child = vec_sub(child, joint)
                length = norm(toward_child)
                direction = normalize(toward_child)
                previous_axis = normalize(vec_sub(joint, parent))
                if length <= 1e-8 or direction is None or previous_axis is None:
                    continue

                original_direction = direction
                internal_angle = angle_deg(toward_parent, toward_child)
                direction, changed = straighten_if_too_folded(
                    direction,
                    toward_parent,
                    internal_angle,
                    min_angle_for(level, is_thumb, args),
                )
                if changed:
                    counts["angle"] += 1

                direction, changed = constrain_to_flexion_plane(
                    direction,
                    previous_axis,
                    basis,
                    sidebend_limit_for(level, is_thumb, args),
                    args.flexion_plane_strength if level else args.flexion_plane_strength * 0.5,
                )
                if changed:
                    counts["sidebend"] += 1
                    if level > 0:
                        counts["torsion"] += 1

                if direction != original_direction:
                    new_child = vec_add(joint, vec_mul(direction, length))
                    delta = vec_sub(new_child, child)
                    set_xyz(frame, child_index, new_child)
                    move_descendants(frame, chain, child_index, delta)

    return counts


def clamp_final_bone_lengths(
    frames: list[list[Any]],
    references: dict[tuple[int, int], float],
    args: argparse.Namespace,
) -> int:
    changed = 0
    for frame in frames:
        for chain in FINGER_CHAINS.values():
            for parent_index, child_index in zip(chain, chain[1:]):
                reference = references.get((parent_index, child_index))
                parent = point_xyz(frame, parent_index)
                child = point_xyz(frame, child_index)
                if reference is None or parent is None or child is None:
                    continue
                delta = vec_sub(child, parent)
                length = norm(delta)
                direction = normalize(delta)
                if length <= 1e-8 or direction is None:
                    continue
                target = clamp(length, reference * args.bone_min_ratio, reference * args.bone_max_ratio)
                if abs(target - length) <= 1e-8:
                    continue
                new_child = vec_add(parent, vec_mul(direction, target))
                move_delta = vec_sub(new_child, child)
                set_xyz(frame, child_index, new_child)
                move_descendants(frame, chain, child_index, move_delta)
                changed += 1
    return changed


def qa_output_stem(output_prefix: str, source_stem: str) -> str:
    for prefix in ("mlp_v0_5_QA_full_", "mlp_v0_5_QA_"):
        if source_stem.startswith(prefix):
            return f"{output_prefix}_{source_stem[len(prefix):]}"
    return f"{output_prefix}_{source_stem}"


def process_file(task: tuple[Path, argparse.Namespace]) -> dict[str, Any]:
    path, args = task
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    sample = payload.get("sample") or {}
    keypoints = sample.get("keypoints") or {}
    estimated = keypoints.get("estimated_3d") or {}
    image_2d = keypoints.get("image_2d") or {}
    pose = copy.deepcopy(values_for(estimated, "pose"))
    left = copy.deepcopy(values_for(estimated, "left_hand"))
    right = copy.deepcopy(values_for(estimated, "right_hand"))
    face = copy.deepcopy(values_for(estimated, "face"))
    if not pose or not left or not right:
        return {"path": str(path), "status": "skipped", "reason": "missing_estimated_3d"}

    left_conf = [hand_confidence(image_2d, "left_hand", index) for index in range(len(left))]
    right_conf = [hand_confidence(image_2d, "right_hand", index) for index in range(len(right))]
    left_refs = bone_references(left)
    right_refs = bone_references(right)
    counts = {
        "motion_outlier": 0,
        "motion_interpolate": 0,
        "temporal_blend": temporal_blend(left, left_conf, args) + temporal_blend(right, right_conf, args),
        "angle": 0,
        "sidebend": 0,
        "torsion": 0,
        "bone": 0,
    }
    for key, value in interpolate_motion_outliers(left, args).items():
        counts[key] += value
    for key, value in interpolate_motion_outliers(right, args).items():
        counts[key] += value
    for key, value in apply_chain_ik(left, smooth_basis_sequence(left, args.basis_smooth_alpha), left_refs, args).items():
        counts[key] += value
    for key, value in apply_chain_ik(right, smooth_basis_sequence(right, args.basis_smooth_alpha), right_refs, args).items():
        counts[key] += value
    counts["bone"] = clamp_final_bone_lengths(left, left_refs, args) + clamp_final_bone_lengths(right, right_refs, args)

    keypoints["postprocessed_3d"] = {
        "pose": shape_block(pose, 25),
        "left_hand": shape_block(left, HAND_JOINT_COUNT),
        "right_hand": shape_block(right, HAND_JOINT_COUNT),
        "face": shape_block(face, 70),
    }
    spaces = sample.setdefault("spaces", {})
    spaces["postprocessed_3d"] = {
        "available": True,
        "coordinate_space": "viewer_normalized_xy_with_hand_lifting_mlp_v0_5_motion_ik_postprocess",
    }
    processing = sample.setdefault("processing", {})
    processing["postprocessed_3d_method"] = "hand_lifting_v0_5_motion_ik_postprocess_v3"
    processing["postprocessed_3d_created_at"] = datetime.now(timezone.utc).isoformat()
    processing["postprocessed_3d_correction_counts"] = counts

    output_path = path
    if args.write_copy:
        output_path = path.with_name(f"{qa_output_stem(args.output_prefix, path.stem)}.json")
        if output_path.exists() and not args.overwrite:
            return {"path": str(path), "output": str(output_path), "status": "skipped", "reason": "output_exists"}
        payload["word"] = output_path.stem
        payload["viewer_qa_alias"] = {
            "source_word": path.stem,
            "purpose": "hand_lifting_v0_5_motion_ik_postprocessed_3d_viewer_qa",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"path": str(path), "output": str(output_path), "status": "written", "counts": counts}


def main() -> int:
    args = parse_args()
    include_patterns = args.include_patterns or ["mlp_v0_5_QA_full_*.json"]
    files = sorted({
        path
        for pattern in include_patterns
        for path in args.word_root.glob(pattern)
        if path.is_file()
    })
    tasks = [(path, args) for path in files]
    if args.workers and args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            results = list(executor.map(process_file, tasks))
    else:
        results = [process_file(task) for task in tasks]

    summary = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "word_root": str(args.word_root),
        "include_patterns": include_patterns,
        "output_prefix": args.output_prefix,
        "file_count": len(files),
        "written_count": sum(1 for item in results if item["status"] == "written"),
        "skipped_count": sum(1 for item in results if item["status"] == "skipped"),
        "config": {
            "bone_min_ratio": args.bone_min_ratio,
            "bone_max_ratio": args.bone_max_ratio,
            "mcp_min_angle_deg": args.mcp_min_angle_deg,
            "pip_min_angle_deg": args.pip_min_angle_deg,
            "dip_min_angle_deg": args.dip_min_angle_deg,
            "mcp_sidebend_limit": args.mcp_sidebend_limit,
            "pip_sidebend_limit": args.pip_sidebend_limit,
            "dip_sidebend_limit": args.dip_sidebend_limit,
            "flexion_plane_strength": args.flexion_plane_strength,
            "low_confidence_threshold": args.low_confidence_threshold,
            "mid_confidence_threshold": args.mid_confidence_threshold,
            "low_confidence_blend": args.low_confidence_blend,
            "mid_confidence_blend": args.mid_confidence_blend,
            "thumb_angle_scale": args.thumb_angle_scale,
            "thumb_sidebend_scale": args.thumb_sidebend_scale,
            "finger_motion_ratio_threshold": args.finger_motion_ratio_threshold,
            "finger_motion_absolute_threshold": args.finger_motion_absolute_threshold,
            "tip_motion_absolute_threshold": args.tip_motion_absolute_threshold,
            "finger_local_motion_threshold": args.finger_local_motion_threshold,
            "tip_local_motion_threshold": args.tip_local_motion_threshold,
            "motion_blend": args.motion_blend,
            "motion_clamp_strength": args.motion_clamp_strength,
        },
        "aggregate_counts": aggregate_counts(results),
        "results": results,
    }
    summary_path = args.summary_output or (args.word_root / f"{args.output_prefix}_postprocess_summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("file_count", "written_count", "skipped_count", "aggregate_counts")}, ensure_ascii=False))
    print(f"Summary: {summary_path}")
    return 0


def aggregate_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    aggregate: dict[str, int] = {}
    for result in results:
        counts = result.get("counts") if isinstance(result.get("counts"), dict) else {}
        for key, value in counts.items():
            aggregate[key] = aggregate.get(key, 0) + int(value or 0)
    return aggregate


if __name__ == "__main__":
    raise SystemExit(main())
