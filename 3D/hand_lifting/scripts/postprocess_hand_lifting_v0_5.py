#!/usr/bin/env python3
"""Postprocess v0.5 estimated_3d word JSONs for viewer QA.

This adds ``sample.keypoints.postprocessed_3d`` and leaves ``estimated_3d``
unchanged. The corrections are intentionally conservative: they smooth temporal
jitter, clamp large jumps, stabilize bone lengths, and apply soft finger angle
and palm-normal constraints.
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

POSE_RIGHT_SHOULDER = 2
POSE_RIGHT_ELBOW = 3
POSE_RIGHT_WRIST = 4
POSE_LEFT_SHOULDER = 5
POSE_LEFT_ELBOW = 6
POSE_LEFT_WRIST = 7
HAND_BONES = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12),
    (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
)
FINGER_CHAINS = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", type=Path, default=THREE_D_ROOT / "data" / "words")
    parser.add_argument("--include-pattern", default="mlp_v0_5_QA_*.json")
    parser.add_argument("--output-prefix", default="post_v0_5_QA")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--write-copy", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--min-confidence", type=float, default=0.2)
    parser.add_argument("--smooth-alpha-high", type=float, default=0.75)
    parser.add_argument("--smooth-alpha-low", type=float, default=0.35)
    parser.add_argument("--max-jump", type=float, default=0.18)
    parser.add_argument("--bone-min-ratio", type=float, default=0.45)
    parser.add_argument("--bone-max-ratio", type=float, default=1.8)
    parser.add_argument("--finger-min-angle-deg", type=float, default=55.0)
    parser.add_argument("--normal-component-limit", type=float, default=0.55)
    parser.add_argument("--summary-output", type=Path)
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


def smooth_sequence(frames: list[list[Any]], confidences: list[float], args: argparse.Namespace) -> int:
    changed = 0
    for frame_index in range(1, len(frames)):
        alpha = args.smooth_alpha_high if confidences[frame_index] >= args.min_confidence else args.smooth_alpha_low
        for joint_index in range(min(len(frames[frame_index]), len(frames[frame_index - 1]))):
            current = point_xyz(frames[frame_index], joint_index)
            previous = point_xyz(frames[frame_index - 1], joint_index)
            if current is None or previous is None:
                continue
            smoothed = [current[axis] * alpha + previous[axis] * (1.0 - alpha) for axis in range(3)]
            set_xyz(frames[frame_index], joint_index, smoothed)
            changed += 1
    return changed


def clamp_jumps(frames: list[list[Any]], max_jump: float) -> int:
    changed = 0
    for frame_index in range(1, len(frames)):
        for joint_index in range(min(len(frames[frame_index]), len(frames[frame_index - 1]))):
            current = point_xyz(frames[frame_index], joint_index)
            previous = point_xyz(frames[frame_index - 1], joint_index)
            if current is None or previous is None:
                continue
            delta = vec_sub(current, previous)
            distance = norm(delta)
            if distance > max_jump:
                direction = normalize(delta)
                if direction is None:
                    continue
                set_xyz(frames[frame_index], joint_index, vec_add(previous, vec_mul(direction, max_jump)))
                changed += 1
    return changed


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) * 0.5


def clamp_bone_lengths(frames: list[list[Any]], args: argparse.Namespace) -> int:
    reference: dict[tuple[int, int], float] = {}
    for bone in HAND_BONES:
        lengths = []
        for frame in frames:
            a = point_xyz(frame, bone[0])
            b = point_xyz(frame, bone[1])
            if a is not None and b is not None:
                length = norm(vec_sub(b, a))
                if length > 1e-8:
                    lengths.append(length)
        med = median(lengths)
        if med:
            reference[bone] = med

    changed = 0
    for frame in frames:
        for a_index, b_index in HAND_BONES:
            ref = reference.get((a_index, b_index))
            a = point_xyz(frame, a_index)
            b = point_xyz(frame, b_index)
            if ref is None or a is None or b is None:
                continue
            delta = vec_sub(b, a)
            length = norm(delta)
            if length <= 1e-8:
                continue
            target_length = min(max(length, ref * args.bone_min_ratio), ref * args.bone_max_ratio)
            if abs(target_length - length) > 1e-8:
                direction = vec_mul(delta, 1.0 / length)
                set_xyz(frame, b_index, vec_add(a, vec_mul(direction, target_length)))
                changed += 1
    return changed


def palm_normal(frame: list[Any]) -> list[float] | None:
    wrist = point_xyz(frame, 0)
    index_mcp = point_xyz(frame, 5)
    pinky_mcp = point_xyz(frame, 17)
    if wrist is None or index_mcp is None or pinky_mcp is None:
        return None
    return normalize(cross(vec_sub(index_mcp, wrist), vec_sub(pinky_mcp, wrist)))


def angle_deg(a: list[float], b: list[float]) -> float | None:
    na = normalize(a)
    nb = normalize(b)
    if na is None or nb is None:
        return None
    value = max(-1.0, min(1.0, dot(na, nb)))
    return math.degrees(math.acos(value))


def apply_finger_constraints(frames: list[list[Any]], args: argparse.Namespace) -> int:
    changed = 0
    min_angle = args.finger_min_angle_deg
    for frame in frames:
        normal = palm_normal(frame)
        for chain in FINGER_CHAINS:
            for parent_index, joint_index, child_index in zip(chain, chain[1:], chain[2:]):
                parent = point_xyz(frame, parent_index)
                joint = point_xyz(frame, joint_index)
                child = point_xyz(frame, child_index)
                if parent is None or joint is None or child is None:
                    continue
                toward_parent = vec_sub(parent, joint)
                toward_child = vec_sub(child, joint)
                length = norm(toward_child)
                if length <= 1e-8:
                    continue
                angle = angle_deg(toward_parent, toward_child)
                direction = normalize(toward_child)
                if direction is None:
                    continue
                if angle is not None and angle < min_angle:
                    away_from_parent = normalize(vec_mul(toward_parent, -1.0))
                    if away_from_parent is not None:
                        strength = (min_angle - angle) / max(min_angle, 1.0)
                        direction = normalize(vec_add(vec_mul(direction, 1.0 - strength), vec_mul(away_from_parent, strength)))
                        if direction is None:
                            continue
                        changed += 1
                if normal is not None:
                    normal_component = dot(direction, normal)
                    if abs(normal_component) > args.normal_component_limit:
                        limited_component = args.normal_component_limit if normal_component > 0 else -args.normal_component_limit
                        tangent = vec_sub(direction, vec_mul(normal, normal_component))
                        tangent_norm = normalize(tangent) or [0.0, 0.0, 0.0]
                        tangent_scale = math.sqrt(max(0.0, 1.0 - limited_component * limited_component))
                        direction = normalize(vec_add(vec_mul(tangent_norm, tangent_scale), vec_mul(normal, limited_component)))
                        if direction is None:
                            continue
                        changed += 1
                set_xyz(frame, child_index, vec_add(joint, vec_mul(direction, length)))
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
    pose_conf = [max(l, r) for l, r in zip(left_conf, right_conf)]
    counts = {
        "smooth": smooth_sequence(pose, pose_conf, args)
        + smooth_sequence(left, left_conf, args)
        + smooth_sequence(right, right_conf, args),
        "jump": clamp_jumps(pose, args.max_jump)
        + clamp_jumps(left, args.max_jump)
        + clamp_jumps(right, args.max_jump),
        "bone": clamp_bone_lengths(left, args) + clamp_bone_lengths(right, args),
        "finger_constraints": apply_finger_constraints(left, args) + apply_finger_constraints(right, args),
    }

    keypoints["postprocessed_3d"] = {
        "pose": shape_block(pose, 25),
        "left_hand": shape_block(left, 21),
        "right_hand": shape_block(right, 21),
        "face": shape_block(face, 70),
    }
    spaces = sample.setdefault("spaces", {})
    spaces["postprocessed_3d"] = {
        "available": True,
        "coordinate_space": "viewer_normalized_xy_with_hand_lifting_mlp_v0_5_postprocess",
    }
    processing = sample.setdefault("processing", {})
    processing["postprocessed_3d_method"] = "hand_lifting_v0_5_postprocess_v1"
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
            "purpose": "hand_lifting_v0_5_postprocessed_3d_viewer_qa",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"path": str(path), "output": str(output_path), "status": "written", "counts": counts}


def main() -> int:
    args = parse_args()
    files = sorted(path for path in args.word_root.glob(args.include_pattern) if path.is_file())
    tasks = [(path, args) for path in files]
    if args.workers and args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            results = list(executor.map(process_file, tasks))
    else:
        results = [process_file(task) for task in tasks]

    summary = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "word_root": str(args.word_root),
        "include_pattern": args.include_pattern,
        "file_count": len(files),
        "written_count": sum(1 for item in results if item["status"] == "written"),
        "skipped_count": sum(1 for item in results if item["status"] == "skipped"),
        "results": results,
    }
    summary_path = args.summary_output or (args.word_root / f"{args.output_prefix}_postprocess_summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("file_count", "written_count", "skipped_count")}, ensure_ascii=False))
    print(f"Summary: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
