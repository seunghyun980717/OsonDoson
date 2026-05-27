#!/usr/bin/env python3
"""Build frame-level quality masks for hand-lifting training.

Inputs:
  - AIHub keypoint sequence folders.
  - Trim metadata from build_motion_trim_metadata.py.

Outputs:
  - JSONL rows for frames inside each trim range.
  - Compact summary JSON.

The mask is target-oriented: wrist/palm can remain usable even when finger
targets are rejected. This lets the first hand-lifting model learn reliable
wrist/palm depth while treating finger depth as optional/weak supervision.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from statistics import median
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
POSE_FACE_SAFE = (15, 16, 17)

HAND_WRIST = 0
PALM_CENTER_INDICES = (0, 5, 9, 13, 17)
HAND_BONES = (
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
)
PALM_BONES = (
    (2, 5, "palm_thumb_mcp_to_index_mcp"),
    (5, 9, "palm_index_mcp_to_middle_mcp"),
    (9, 13, "palm_middle_mcp_to_ring_mcp"),
    (13, 17, "palm_ring_mcp_to_pinky_mcp"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keypoint-root",
        required=True,
        action="append",
        type=Path,
        help="Directory containing *_F sequence folders. Can be provided multiple times.",
    )
    parser.add_argument(
        "--trim-metadata",
        required=True,
        type=Path,
        help="Trim metadata JSON or JSONL from build_motion_trim_metadata.py.",
    )
    parser.add_argument(
        "--output-jsonl",
        required=True,
        type=Path,
        help="Frame-level quality mask JSONL output.",
    )
    parser.add_argument(
        "--summary-output",
        required=True,
        type=Path,
        help="Compact summary JSON output.",
    )
    parser.add_argument(
        "--sequence-glob",
        default="*_F",
        help="Sequence folder glob. Default: *_F.",
    )
    parser.add_argument(
        "--distortion-mode",
        default="apply",
        choices=("apply", "none"),
        help="Apply camparam distortion while projecting 3D to 2D. Default: apply.",
    )
    parser.add_argument(
        "--wrist-reproj-px",
        default=40.0,
        type=float,
        help="Max wrist reprojection error for wrist depth target. Default: 40.",
    )
    parser.add_argument(
        "--palm-reproj-px",
        default=40.0,
        type=float,
        help="Max palm joint reprojection p95 for palm depth target. Default: 40.",
    )
    parser.add_argument(
        "--finger-reproj-px",
        default=30.0,
        type=float,
        help="Max hand joint reprojection p95 for finger depth targets. Default: 30.",
    )
    parser.add_argument(
        "--bone-mad-factor",
        default=3.0,
        type=float,
        help="Reject bones farther than factor * MAD from sequence median. Default: 3.",
    )
    parser.add_argument(
        "--bone-abs-mm",
        default=8.0,
        type=float,
        help="Minimum absolute bone outlier tolerance in millimeters. Default: 8.",
    )
    parser.add_argument(
        "--finger-max-bone-outlier-ratio",
        default=0.20,
        type=float,
        help="Max outlier bone ratio for finger depth target. Default: 0.20.",
    )
    parser.add_argument(
        "--palm-max-bone-outlier-ratio",
        default=0.35,
        type=float,
        help="Max outlier palm/internal bone ratio for palm target. Default: 0.35.",
    )
    parser.add_argument(
        "--wrist-accel-threshold",
        default=0.25,
        type=float,
        help="Max root-relative wrist z acceleration. Default: 0.25.",
    )
    parser.add_argument(
        "--palm-accel-threshold",
        default=0.25,
        type=float,
        help="Max root-relative palm z acceleration. Default: 0.25.",
    )
    parser.add_argument(
        "--finger-accel-threshold",
        default=0.35,
        type=float,
        help="Max root-relative finger mean z acceleration. Default: 0.35.",
    )
    parser.add_argument(
        "--include-frame-stats",
        action="store_true",
        help="Include reprojection/bone/acceleration diagnostics in each JSONL row.",
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


def iter_all_sequence_dirs(keypoint_roots: list[Path], sequence_glob: str) -> list[Path]:
    sequence_dirs: list[Path] = []
    seen: set[str] = set()
    duplicates: list[str] = []
    for keypoint_root in keypoint_roots:
        for sequence_dir in iter_sequence_dirs(keypoint_root, sequence_glob):
            if sequence_dir.name in seen:
                duplicates.append(sequence_dir.name)
                continue
            seen.add(sequence_dir.name)
            sequence_dirs.append(sequence_dir)
    if duplicates:
        preview = ", ".join(duplicates[:10])
        raise ValueError(f"Duplicate sequence ids across keypoint roots: {preview}")
    return sorted(sequence_dirs, key=lambda path: path.name)


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


def parse_float_list(raw: Any) -> list[float] | None:
    if isinstance(raw, str):
        raw = raw.split()
    if not isinstance(raw, list):
        return None
    try:
        return [float(value) for value in raw]
    except (TypeError, ValueError):
        return None


def parse_camera(payload: dict[str, Any]) -> tuple[list[float], list[float]] | None:
    camparam = payload.get("camparam")
    if not isinstance(camparam, dict):
        return None
    intrinsics = camparam.get("Intrinsics")
    if not isinstance(intrinsics, dict):
        return None
    k = parse_float_list(intrinsics.get("data"))
    if k is None or len(k) < 9:
        return None
    distortion = camparam.get("Distortion")
    d: list[float] = []
    if isinstance(distortion, dict):
        parsed = parse_float_list(distortion.get("data"))
        if parsed is not None:
            d = parsed
    while len(d) < 5:
        d.append(0.0)
    return k, d[:5]


def parse_point_2d(raw: Any, idx: int, min_conf: float = 0.0) -> tuple[float, float] | None:
    if not isinstance(raw, list) or len(raw) < (idx + 1) * 3:
        return None
    offset = idx * 3
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


def parse_point_3d(raw: Any, idx: int, min_conf: float = 0.0) -> tuple[float, float, float] | None:
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
    if conf <= min_conf or not all(math.isfinite(value) for value in (x, y, z)):
        return None
    if abs(x) < 1e-12 and abs(y) < 1e-12 and abs(z) < 1e-12:
        return None
    return (x, y, z)


def dist3(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def infer_scale_to_mm(people: dict[str, Any]) -> float:
    pose = people.get("pose_keypoints_3d")
    left = parse_point_3d(pose, POSE_LEFT_SHOULDER)
    right = parse_point_3d(pose, POSE_RIGHT_SHOULDER)
    if left is not None and right is not None:
        return 1.0 if dist3(left, right) > 10.0 else 1000.0
    for key in ("hand_left_keypoints_3d", "hand_right_keypoints_3d"):
        point = parse_point_3d(people.get(key), HAND_WRIST)
        if point is not None:
            return 1.0 if abs(point[2]) > 10.0 else 1000.0
    return 1000.0


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


def mean_or_none(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def p95_or_none(values: list[float]) -> float | None:
    return percentile(values, 0.95)


def median_abs_deviation(values: list[float], med: float) -> float:
    return median([abs(value - med) for value in values]) if values else 0.0


def load_trim_metadata(path: Path) -> dict[str, dict[str, Any]]:
    if path.suffix.lower() == ".jsonl":
        trims: dict[str, dict[str, Any]] = {}
        with path.open("r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                trims[row["sequence_id"]] = row
        return trims

    payload = load_json(path)
    if payload is None:
        raise ValueError(f"Invalid trim metadata: {path}")
    trims = payload.get("trims")
    if isinstance(trims, dict):
        return trims
    if "sequence_id" in payload:
        return {payload["sequence_id"]: payload}
    raise ValueError(f"Unsupported trim metadata shape: {path}")


def hand_keys(hand: str) -> tuple[str, str]:
    if hand == "left":
        return "hand_left_keypoints_2d", "hand_left_keypoints_3d"
    return "hand_right_keypoints_2d", "hand_right_keypoints_3d"


def pose_wrist_index(hand: str) -> int:
    # AIHub BODY25 sample maps left hand to pose index 7 and right hand to 4.
    return POSE_LEFT_WRIST if hand == "left" else POSE_RIGHT_WRIST


def palm_center_z(points: list[tuple[float, float, float] | None]) -> float | None:
    valid = [points[idx] for idx in PALM_CENTER_INDICES if points[idx] is not None]
    if not valid:
        return None
    return sum(point[2] for point in valid if point is not None) / len(valid)


def shoulder_root_and_width(people: dict[str, Any]) -> tuple[float, float] | None:
    pose = people.get("pose_keypoints_3d")
    left = parse_point_3d(pose, POSE_LEFT_SHOULDER)
    right = parse_point_3d(pose, POSE_RIGHT_SHOULDER)
    if left is None or right is None:
        return None
    width = dist3(left, right)
    if width <= 1e-9:
        return None
    return ((left[2] + right[2]) / 2.0, width)


def root_relative_z(z: float | None, root_width: tuple[float, float] | None) -> float | None:
    if z is None or root_width is None:
        return None
    root_z, width = root_width
    return (z - root_z) / width


def accel_at(series: list[float | None], index: int) -> float | None:
    if index <= 0 or index >= len(series) - 1:
        return 0.0
    prev_value = series[index - 1]
    curr_value = series[index]
    next_value = series[index + 1]
    if prev_value is None or curr_value is None or next_value is None:
        return None
    return next_value - 2.0 * curr_value + prev_value


def frame_reprojection_errors(
    people: dict[str, Any],
    camera: tuple[list[float], list[float]] | None,
    distortion_mode: str,
    hand: str,
) -> dict[str, Any]:
    if camera is None:
        return {"wrist": None, "palm_p95": None, "hand_p95": None, "valid_joint_count": 0}
    k, d = camera
    hand_2d_key, hand_3d_key = hand_keys(hand)
    hand_2d = people.get(hand_2d_key)
    hand_3d = people.get(hand_3d_key)
    errors: list[float] = []
    palm_errors: list[float] = []
    wrist_error: float | None = None
    for idx in range(21):
        point_2d = parse_point_2d(hand_2d, idx)
        point_3d = parse_point_3d(hand_3d, idx)
        if point_2d is None or point_3d is None:
            continue
        projected = project_point(point_3d, k, d, distortion_mode)
        if projected is None:
            continue
        error = math.dist(projected, point_2d)
        if not math.isfinite(error):
            continue
        errors.append(error)
        if idx == HAND_WRIST:
            wrist_error = error
        if idx in PALM_CENTER_INDICES:
            palm_errors.append(error)
    return {
        "wrist": wrist_error,
        "palm_p95": p95_or_none(palm_errors),
        "hand_p95": p95_or_none(errors),
        "valid_joint_count": len(errors),
    }


def parse_hand_points_3d(people: dict[str, Any], hand: str) -> list[tuple[float, float, float] | None]:
    _, key_3d = hand_keys(hand)
    raw = people.get(key_3d)
    return [parse_point_3d(raw, idx) for idx in range(21)]


def compute_bone_lengths_mm(
    points: list[tuple[float, float, float] | None],
    scale_to_mm: float,
    include_palm: bool,
) -> dict[str, float]:
    output: dict[str, float] = {}
    bones = list(HAND_BONES)
    if include_palm:
        bones.extend(PALM_BONES)
    for start, end, name in bones:
        p1 = points[start]
        p2 = points[end]
        if p1 is None or p2 is None:
            continue
        output[name] = dist3(p1, p2) * scale_to_mm
    return output


def bone_reference(
    frame_bones: list[dict[str, float]]
) -> dict[str, tuple[float, float]]:
    values_by_bone: dict[str, list[float]] = defaultdict(list)
    for bones in frame_bones:
        for bone, value in bones.items():
            values_by_bone[bone].append(value)

    refs: dict[str, tuple[float, float]] = {}
    for bone, values in values_by_bone.items():
        if not values:
            continue
        med = median(values)
        mad = median_abs_deviation(values, med)
        refs[bone] = (med, mad)
    return refs


def bone_outlier_ratio(
    bones: dict[str, float],
    refs: dict[str, tuple[float, float]],
    bone_names: set[str],
    mad_factor: float,
    abs_tolerance_mm: float,
) -> tuple[float | None, list[str]]:
    checked = 0
    outliers: list[str] = []
    for bone, value in bones.items():
        if bone not in bone_names or bone not in refs:
            continue
        checked += 1
        med, mad = refs[bone]
        tolerance = max(abs_tolerance_mm, mad_factor * mad)
        if abs(value - med) > tolerance:
            outliers.append(bone)
    if checked == 0:
        return None, outliers
    return len(outliers) / checked, outliers


def analyze_sequence(
    sequence_dir: Path,
    trim: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    frame_files = iter_frame_files(sequence_dir)
    frame_count = len(frame_files)
    start = max(0, int(trim["trim_start_frame"]))
    end = min(frame_count - 1, int(trim["trim_end_frame"]))
    if end < start:
        return [], {"sequence_id": sequence_dir.name, "status": "empty_trim"}

    payloads: list[dict[str, Any] | None] = []
    peoples: list[dict[str, Any] | None] = []
    cameras: list[tuple[list[float], list[float]] | None] = []
    root_widths: list[tuple[float, float] | None] = []
    hand_points: dict[str, list[list[tuple[float, float, float] | None]]] = {"left": [], "right": []}
    hand_bones: dict[str, list[dict[str, float]]] = {"left": [], "right": []}
    z_series: dict[str, dict[str, list[float | None]]] = {
        "left": {"wrist": [], "palm": [], "finger_mean": []},
        "right": {"wrist": [], "palm": [], "finger_mean": []},
    }

    for frame_file in frame_files:
        payload = load_json(frame_file)
        people = get_people(payload) if payload is not None else None
        payloads.append(payload)
        peoples.append(people)
        cameras.append(parse_camera(payload) if payload is not None else None)
        root_width = shoulder_root_and_width(people) if people is not None else None
        root_widths.append(root_width)

        for hand in ("left", "right"):
            points = parse_hand_points_3d(people, hand) if people is not None else [None] * 21
            hand_points[hand].append(points)
            scale = infer_scale_to_mm(people) if people is not None else 1000.0
            hand_bones[hand].append(compute_bone_lengths_mm(points, scale, include_palm=True))
            wrist = points[HAND_WRIST]
            palm_z = palm_center_z(points)
            finger_values = [point[2] for idx, point in enumerate(points) if idx != HAND_WRIST and point is not None]
            finger_mean = sum(finger_values) / len(finger_values) if finger_values else None
            z_series[hand]["wrist"].append(root_relative_z(wrist[2] if wrist else None, root_width))
            z_series[hand]["palm"].append(root_relative_z(palm_z, root_width))
            z_series[hand]["finger_mean"].append(root_relative_z(finger_mean, root_width))

    refs = {
        "left": bone_reference(hand_bones["left"][start : end + 1]),
        "right": bone_reference(hand_bones["right"][start : end + 1]),
    }
    finger_bone_names = {name for _, _, name in HAND_BONES}
    palm_bone_names = {name for _, _, name in PALM_BONES}

    rows: list[dict[str, Any]] = []
    sequence_counter: Counter[str] = Counter()
    for frame_pos in range(start, end + 1):
        frame_file = frame_files[frame_pos]
        people = peoples[frame_pos]
        row: dict[str, Any] = {
            "sequence_id": sequence_dir.name,
            "frame_index": frame_index_from_path(frame_file),
            "frame_position": frame_pos,
            "inside_trim": True,
            "trim_start_frame": start,
            "trim_end_frame": end,
            "hands": {},
        }

        for hand in ("left", "right"):
            reasons: list[str] = []
            if people is None:
                reasons.append("missing_people")
                reproj = {"wrist": None, "palm_p95": None, "hand_p95": None, "valid_joint_count": 0}
            else:
                reproj = frame_reprojection_errors(people, cameras[frame_pos], args.distortion_mode, hand)
                if reproj["valid_joint_count"] < 10:
                    reasons.append("low_valid_hand_joint_count")

            palm_ratio, palm_bone_outliers = bone_outlier_ratio(
                hand_bones[hand][frame_pos],
                refs[hand],
                palm_bone_names,
                args.bone_mad_factor,
                args.bone_abs_mm,
            )
            finger_ratio, finger_bone_outliers = bone_outlier_ratio(
                hand_bones[hand][frame_pos],
                refs[hand],
                finger_bone_names,
                args.bone_mad_factor,
                args.bone_abs_mm,
            )
            wrist_accel = accel_at(z_series[hand]["wrist"], frame_pos)
            palm_accel = accel_at(z_series[hand]["palm"], frame_pos)
            finger_accel = accel_at(z_series[hand]["finger_mean"], frame_pos)

            use_wrist = True
            use_palm = True
            use_finger = True

            if reproj["wrist"] is None or reproj["wrist"] > args.wrist_reproj_px:
                use_wrist = False
                reasons.append("wrist_reprojection_outlier")
            if wrist_accel is None or abs(wrist_accel) > args.wrist_accel_threshold:
                use_wrist = False
                reasons.append("wrist_acceleration_outlier")

            if reproj["palm_p95"] is None or reproj["palm_p95"] > args.palm_reproj_px:
                use_palm = False
                reasons.append("palm_reprojection_outlier")
            if palm_ratio is None or palm_ratio > args.palm_max_bone_outlier_ratio:
                use_palm = False
                reasons.append("palm_bone_outlier")
            if palm_accel is None or abs(palm_accel) > args.palm_accel_threshold:
                use_palm = False
                reasons.append("palm_acceleration_outlier")

            if reproj["hand_p95"] is None or reproj["hand_p95"] > args.finger_reproj_px:
                use_finger = False
                reasons.append("finger_reprojection_outlier")
            if finger_ratio is None or finger_ratio > args.finger_max_bone_outlier_ratio:
                use_finger = False
                reasons.append("finger_bone_outlier")
            if finger_accel is None or abs(finger_accel) > args.finger_accel_threshold:
                use_finger = False
                reasons.append("finger_acceleration_outlier")

            hand_row = {
                "use_wrist_depth": bool(use_wrist),
                "use_palm_depth": bool(use_palm),
                "use_finger_depth": bool(use_finger),
                "reasons": sorted(set(reasons)),
            }
            if args.include_frame_stats:
                hand_row["stats"] = {
                    "reprojection": reproj,
                    "palm_bone_outlier_ratio": palm_ratio,
                    "finger_bone_outlier_ratio": finger_ratio,
                    "palm_bone_outliers": palm_bone_outliers[:8],
                    "finger_bone_outliers": finger_bone_outliers[:8],
                    "wrist_accel": wrist_accel,
                    "palm_accel": palm_accel,
                    "finger_accel": finger_accel,
                }
            row["hands"][hand] = hand_row
            for flag_name, value in (
                (f"{hand}.wrist", use_wrist),
                (f"{hand}.palm", use_palm),
                (f"{hand}.finger", use_finger),
            ):
                sequence_counter[f"{flag_name}.usable" if value else f"{flag_name}.rejected"] += 1
            for reason in set(reasons):
                sequence_counter[f"{hand}.reason.{reason}"] += 1

        rows.append(row)

    summary = {
        "sequence_id": sequence_dir.name,
        "frame_count": frame_count,
        "trim_start_frame": start,
        "trim_end_frame": end,
        "trim_frame_count": len(rows),
        "counts": dict(sorted(sequence_counter.items())),
    }
    return rows, summary


def ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def summarize_all(sequence_summaries: list[dict[str, Any]]) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    trim_frames = 0
    for summary in sequence_summaries:
        trim_frames += int(summary.get("trim_frame_count") or 0)
        counts.update(summary.get("counts") or {})

    result = {
        "sequence_count": len(sequence_summaries),
        "trim_frame_count": trim_frames,
        "counts": dict(sorted(counts.items())),
        "usable_ratios": {},
    }
    for hand in ("left", "right"):
        for target in ("wrist", "palm", "finger"):
            usable = counts.get(f"{hand}.{target}.usable", 0)
            rejected = counts.get(f"{hand}.{target}.rejected", 0)
            result["usable_ratios"][f"{hand}.{target}"] = ratio(usable, usable + rejected)
    return result


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


def analyze_sequence_batch(
    sequence_dirs: list[Path], trims: dict[str, dict[str, Any]], args: argparse.Namespace
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    sequence_summaries: list[dict[str, Any]] = []
    skipped: list[str] = []
    for sequence_dir in sequence_dirs:
        trim = trims.get(sequence_dir.name)
        if trim is None:
            skipped.append(sequence_dir.name)
            continue
        sequence_rows, sequence_summary = analyze_sequence(sequence_dir, trim, args)
        sequence_summaries.append(sequence_summary)
        rows.extend(sequence_rows)
    return {
        "rows": rows,
        "sequence_summaries": sequence_summaries,
        "skipped": skipped,
    }


def main() -> int:
    args = parse_args()
    trims = load_trim_metadata(args.trim_metadata)
    sequence_dirs = iter_all_sequence_dirs(args.keypoint_root, args.sequence_glob)

    rows: list[dict[str, Any]] = []
    sequence_summaries: list[dict[str, Any]] = []
    skipped: list[str] = []
    worker_count = resolve_worker_count(args.workers, len(sequence_dirs))
    if worker_count <= 1 or len(sequence_dirs) <= 1:
        result = analyze_sequence_batch(sequence_dirs, trims, args)
        rows = result["rows"]
        sequence_summaries = result["sequence_summaries"]
        skipped = result["skipped"]
    else:
        chunks = chunk_paths(sequence_dirs, worker_count)
        with ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(analyze_sequence_batch, chunk, trims, args) for chunk in chunks]
            completed = 0
            for future in as_completed(futures):
                result = future.result()
                rows.extend(result["rows"])
                sequence_summaries.extend(result["sequence_summaries"])
                skipped.extend(result["skipped"])
                completed += 1
                print(f"Completed worker chunks: {completed}/{len(futures)}", flush=True)
        rows.sort(key=lambda row: (row["sequence_id"], row["frame_position"]))
        sequence_summaries.sort(key=lambda summary: summary["sequence_id"])
        skipped.sort()

    args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with args.output_jsonl.open("w", encoding="utf-8") as fp:
        for row in rows:
            fp.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "config": {
            "keypoint_roots": [str(path) for path in args.keypoint_root],
            "trim_metadata": str(args.trim_metadata),
            "sequence_glob": args.sequence_glob,
            "distortion_mode": args.distortion_mode,
            "workers": worker_count,
            "thresholds": {
                "wrist_reproj_px": args.wrist_reproj_px,
                "palm_reproj_px": args.palm_reproj_px,
                "finger_reproj_px": args.finger_reproj_px,
                "bone_mad_factor": args.bone_mad_factor,
                "bone_abs_mm": args.bone_abs_mm,
                "finger_max_bone_outlier_ratio": args.finger_max_bone_outlier_ratio,
                "palm_max_bone_outlier_ratio": args.palm_max_bone_outlier_ratio,
                "wrist_accel_threshold": args.wrist_accel_threshold,
                "palm_accel_threshold": args.palm_accel_threshold,
                "finger_accel_threshold": args.finger_accel_threshold,
            },
            "excluded_pose_indices": {
                "lower_body": list(range(8, 15)),
                "feet": list(range(19, 25)),
                "ear": [18],
            },
            "included_pose_indices": {
                "upper_body_arms": list(range(0, 8)),
                "safe_face": list(POSE_FACE_SAFE),
            },
        },
        "summary": summarize_all(sequence_summaries),
        "skipped_sequence_count": len(skipped),
        "skipped_sequences_preview": skipped[:20],
        "sequences": sequence_summaries,
    }
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Sequences: {len(sequence_summaries)}")
    print(f"Skipped: {len(skipped)}")
    print(f"Frames in trim: {summary['summary']['trim_frame_count']}")
    print(f"Mask JSONL: {args.output_jsonl}")
    print(f"Summary: {args.summary_output}")
    print(f"Usable ratios: {summary['summary']['usable_ratios']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
