"""Generated transitions for adjacent word clips with safety checks and fallback."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import numpy as np

from .schemas import (
    POSE_LEFT_ELBOW_INDEX,
    POSE_LEFT_SHOULDER_INDEX,
    POSE_LEFT_WRIST_INDEX,
    POSE_RIGHT_ELBOW_INDEX,
    POSE_RIGHT_SHOULDER_INDEX,
    POSE_RIGHT_WRIST_INDEX,
    ClipAsset,
    TransitionMethod,
)


TAIL_SAMPLES = 4
WRIST_BLEND_POSE = 0.35
WRIST_BLEND_HAND = 0.65
STRONG_CLAMP_SCALE = 0.55
SHORT_TRANSITION_FRAMES = 4
SPEED_RATIO_LIMIT = 2.4
TERMINAL_DISCONTINUITY_LIMIT = 0.9
BILATERAL_SPREAD_MARGIN = 0.65
JOINT_MARGIN_BY_KIND = {
    "wrist": np.asarray([0.35, 0.28, 0.28], dtype=np.float32),
    "elbow": np.asarray([0.28, 0.22, 0.22], dtype=np.float32),
}
TRANSITION_CHECK_JOINTS = (
    ("left_wrist", POSE_LEFT_WRIST_INDEX, "wrist"),
    ("right_wrist", POSE_RIGHT_WRIST_INDEX, "wrist"),
    ("left_elbow", POSE_LEFT_ELBOW_INDEX, "elbow"),
    ("right_elbow", POSE_RIGHT_ELBOW_INDEX, "elbow"),
)
TRANSITION_METHODS = {"linear", "smoothstep", "hermite", "catmull_rom", "bezier"}


def _resolve_transition_frames(prev_clip: ClipAsset, next_clip: ClipAsset) -> int:
    default_frames = int(round(0.25 * prev_clip.fps))
    transition_frames = max(6, min(10, default_frames))

    shortest_clip = min(prev_clip.frame_count, next_clip.frame_count)
    if shortest_clip <= 2:
        return 2

    max_supported = max(2, shortest_clip - 1)
    return min(transition_frames, max_supported)


def _resolve_short_transition_frames(prev_clip: ClipAsset, next_clip: ClipAsset) -> int:
    shortest_clip = min(prev_clip.frame_count, next_clip.frame_count)
    max_supported = max(2, shortest_clip - 1)
    return min(max_supported, SHORT_TRANSITION_FRAMES)


def _smoothstep(t: np.ndarray) -> np.ndarray:
    return t * t * (3.0 - (2.0 * t))


def _estimate_limit(
    prev_frame: np.ndarray,
    prev_prev_frame: np.ndarray,
    next_frame: np.ndarray,
    next_next_frame: np.ndarray,
) -> np.ndarray:
    prev_step = np.linalg.norm(prev_frame[:, :3] - prev_prev_frame[:, :3], axis=1)
    next_step = np.linalg.norm(next_next_frame[:, :3] - next_frame[:, :3], axis=1)
    return np.maximum.reduce([prev_step, next_step, np.full_like(prev_step, 1e-4)]) * 1.5


def _apply_velocity_clamp(frames: np.ndarray, limits: np.ndarray, spatial_dims: int) -> np.ndarray:
    clamped = frames.copy()
    for idx in range(1, clamped.shape[0]):
        delta = clamped[idx, :, :spatial_dims] - clamped[idx - 1, :, :spatial_dims]
        norms = np.linalg.norm(delta, axis=1)
        ratio = np.ones_like(norms)
        mask = norms > limits
        ratio[mask] = limits[mask] / norms[mask]
        clamped[idx, :, :spatial_dims] = clamped[idx - 1, :, :spatial_dims] + (delta * ratio[:, None])
    return clamped


def _linear_values(prev_frame: np.ndarray, next_frame: np.ndarray, weights: np.ndarray) -> np.ndarray:
    return ((1.0 - weights)[:, None, None] * prev_frame[None, ...]) + (weights[:, None, None] * next_frame[None, ...])


def _interpolate_spatial(
    prev_prev_frame: np.ndarray,
    prev_frame: np.ndarray,
    next_frame: np.ndarray,
    next_next_frame: np.ndarray,
    weights: np.ndarray,
    method: str,
    spatial_dims: int,
) -> np.ndarray:
    p0 = prev_prev_frame[:, :spatial_dims]
    p1 = prev_frame[:, :spatial_dims]
    p2 = next_frame[:, :spatial_dims]
    p3 = next_next_frame[:, :spatial_dims]
    t = weights[:, None, None]

    if method == "linear":
        return ((1.0 - t) * p1[None, ...]) + (t * p2[None, ...])

    if method == "smoothstep":
        eased = _smoothstep(weights)[:, None, None]
        return ((1.0 - eased) * p1[None, ...]) + (eased * p2[None, ...])

    if method == "hermite":
        m0 = p1 - p0
        m1 = p3 - p2
        t2 = t * t
        t3 = t2 * t
        return (
            ((2.0 * t3 - 3.0 * t2 + 1.0) * p1[None, ...])
            + ((t3 - 2.0 * t2 + t) * m0[None, ...])
            + ((-2.0 * t3 + 3.0 * t2) * p2[None, ...])
            + ((t3 - t2) * m1[None, ...])
        )

    if method == "catmull_rom":
        t2 = t * t
        t3 = t2 * t
        return 0.5 * (
            (2.0 * p1[None, ...])
            + ((-p0 + p2)[None, ...] * t)
            + ((2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3)[None, ...] * t2)
            + ((-p0 + 3.0 * p1 - 3.0 * p2 + p3)[None, ...] * t3)
        )

    if method == "bezier":
        c0 = p1
        c1 = p1 + ((p1 - p0) / 3.0)
        c2 = p2 - ((p3 - p2) / 3.0)
        c3 = p2
        omt = 1.0 - t
        return (
            (omt * omt * omt * c0[None, ...])
            + (3.0 * omt * omt * t * c1[None, ...])
            + (3.0 * omt * t * t * c2[None, ...])
            + (t * t * t * c3[None, ...])
        )

    raise ValueError(f"Unsupported transition method: {method}")


def _interpolate_frames(
    prev_array: np.ndarray,
    next_array: np.ndarray,
    transition_frames: int,
    method: str,
) -> tuple[np.ndarray, int]:
    if method not in TRANSITION_METHODS:
        raise ValueError(f"Unsupported transition method: {method}")

    prev_frame = prev_array[-1]
    next_frame = next_array[0]
    prev_prev_frame = prev_array[-2] if prev_array.shape[0] > 1 else prev_frame
    next_next_frame = next_array[1] if next_array.shape[0] > 1 else next_frame
    spatial_dims = 3 if prev_frame.shape[-1] >= 4 else 2
    ts = np.linspace(
        1.0 / (transition_frames + 1),
        transition_frames / (transition_frames + 1),
        transition_frames,
        dtype=np.float32,
    )
    output = _linear_values(prev_frame, next_frame, ts).astype(np.float32)
    output[:, :, :spatial_dims] = _interpolate_spatial(
        prev_prev_frame,
        prev_frame,
        next_frame,
        next_next_frame,
        ts,
        method,
        spatial_dims,
    ).astype(np.float32)
    return output, spatial_dims


def _canonical_wrist(pose_frame: np.ndarray, hand_frame: np.ndarray, wrist_index: int) -> np.ndarray:
    return (WRIST_BLEND_POSE * pose_frame[wrist_index, :3]) + (WRIST_BLEND_HAND * hand_frame[0, :3])


def _shoulder_center_and_width(pose_frames: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    centers = (
        pose_frames[:, POSE_LEFT_SHOULDER_INDEX, :3] + pose_frames[:, POSE_RIGHT_SHOULDER_INDEX, :3]
    ) * 0.5
    widths = np.linalg.norm(
        pose_frames[:, POSE_LEFT_SHOULDER_INDEX, :3] - pose_frames[:, POSE_RIGHT_SHOULDER_INDEX, :3],
        axis=1,
    )
    widths = np.maximum(widths, 1e-3)
    return centers, widths


def _normalize_joint_positions(pose_frames: np.ndarray, joint_index: int) -> np.ndarray:
    centers, widths = _shoulder_center_and_width(pose_frames)
    return (pose_frames[:, joint_index, :3] - centers) / widths[:, None]


def _denormalize_joint_positions(pose_frames: np.ndarray, normalized: np.ndarray) -> np.ndarray:
    centers, widths = _shoulder_center_and_width(pose_frames)
    return centers + (normalized * widths[:, None])


def _clamp_normalized_series(
    series: np.ndarray,
    prev_point: np.ndarray,
    next_point: np.ndarray,
    joint_kind: str,
    clamp_scale: float,
) -> tuple[np.ndarray, float, str]:
    margin = JOINT_MARGIN_BY_KIND[joint_kind] * clamp_scale
    lower = np.minimum(prev_point, next_point) - margin
    upper = np.maximum(prev_point, next_point) + margin
    clamped = np.clip(series, lower[None, :], upper[None, :])
    delta = np.abs(clamped - series)
    flat_index = int(np.argmax(delta))
    axis_index = flat_index % 3
    axis_name = ("x", "y", "z")[axis_index]
    return clamped, float(delta.max()), axis_name


def _apply_normalized_constraints(
    pose_frames: np.ndarray,
    prev_pose: np.ndarray,
    next_pose: np.ndarray,
    clamp_scale: float,
) -> tuple[np.ndarray, dict[str, dict[str, Any]]]:
    constrained = pose_frames.copy()
    clamp_info: dict[str, dict[str, Any]] = {}

    for joint_name, joint_index, joint_kind in TRANSITION_CHECK_JOINTS:
        series = _normalize_joint_positions(constrained, joint_index)
        prev_point = _normalize_joint_positions(prev_pose[None, ...], joint_index)[0]
        next_point = _normalize_joint_positions(next_pose[None, ...], joint_index)[0]
        clamped_series, max_delta, axis_name = _clamp_normalized_series(
            series,
            prev_point,
            next_point,
            joint_kind,
            clamp_scale,
        )
        constrained[:, joint_index, :3] = _denormalize_joint_positions(constrained, clamped_series)
        clamp_info[joint_name] = {
            "max_delta": max_delta,
            "axis": axis_name,
        }

    left_wrist = _normalize_joint_positions(constrained, POSE_LEFT_WRIST_INDEX)
    right_wrist = _normalize_joint_positions(constrained, POSE_RIGHT_WRIST_INDEX)
    prev_spread = np.abs(_normalize_joint_positions(prev_pose[None, ...], POSE_LEFT_WRIST_INDEX)[0, 0]) + np.abs(
        _normalize_joint_positions(prev_pose[None, ...], POSE_RIGHT_WRIST_INDEX)[0, 0]
    )
    next_spread = np.abs(_normalize_joint_positions(next_pose[None, ...], POSE_LEFT_WRIST_INDEX)[0, 0]) + np.abs(
        _normalize_joint_positions(next_pose[None, ...], POSE_RIGHT_WRIST_INDEX)[0, 0]
    )
    max_spread = max(prev_spread, next_spread) + (BILATERAL_SPREAD_MARGIN * clamp_scale)
    current_spread = np.abs(left_wrist[:, 0]) + np.abs(right_wrist[:, 0])
    spread_mask = current_spread > max_spread
    if np.any(spread_mask):
        ratio = (max_spread / np.maximum(current_spread[spread_mask], 1e-4))[:, None]
        left_wrist[spread_mask, 0:1] *= ratio
        right_wrist[spread_mask, 0:1] *= ratio
        constrained[:, POSE_LEFT_WRIST_INDEX, :3] = _denormalize_joint_positions(constrained, left_wrist)
        constrained[:, POSE_RIGHT_WRIST_INDEX, :3] = _denormalize_joint_positions(constrained, right_wrist)
    clamp_info["bilateral_spread"] = {
        "max_delta": float(np.maximum(current_spread - max_spread, 0.0).max(initial=0.0)),
        "axis": "x",
    }
    return constrained, clamp_info


def _apply_wrist_anchor(
    pose_frames: np.ndarray,
    hand_frames: np.ndarray,
    prev_pose: np.ndarray,
    next_pose: np.ndarray,
    prev_hand: np.ndarray,
    next_hand: np.ndarray,
    wrist_index: int,
    clamp_scale: float,
) -> tuple[np.ndarray, np.ndarray]:
    prev_canonical = _canonical_wrist(prev_pose, prev_hand, wrist_index)
    next_canonical = _canonical_wrist(next_pose, next_hand, wrist_index)

    ts = np.linspace(
        1.0 / (pose_frames.shape[0] + 1),
        pose_frames.shape[0] / (pose_frames.shape[0] + 1),
        pose_frames.shape[0],
        dtype=np.float32,
    )
    eased = _smoothstep(ts)
    canonical_path = ((1.0 - eased)[:, None] * prev_canonical[None, :]) + (eased[:, None] * next_canonical[None, :])

    canonical_pose = pose_frames.copy()
    canonical_pose[:, wrist_index, :3] = canonical_path
    canonical_norm = _normalize_joint_positions(canonical_pose, wrist_index)
    prev_norm = _normalize_joint_positions(prev_pose[None, ...], wrist_index)[0]
    next_norm = _normalize_joint_positions(next_pose[None, ...], wrist_index)[0]
    clamped_norm, _, _ = _clamp_normalized_series(
        canonical_norm,
        prev_norm,
        next_norm,
        "wrist",
        clamp_scale,
    )
    canonical_path = _denormalize_joint_positions(canonical_pose, clamped_norm)

    prev_offsets = prev_hand[:, :3] - prev_hand[0, :3]
    next_offsets = next_hand[:, :3] - next_hand[0, :3]

    for index, weight in enumerate(eased):
        pose_frames[index, wrist_index, :3] = canonical_path[index]
        hand_frames[index, 0, :3] = canonical_path[index]
        blended_offsets = ((1.0 - weight) * prev_offsets) + (weight * next_offsets)
        hand_frames[index, :, :3] = canonical_path[index][None, :] + blended_offsets
    return pose_frames, hand_frames


def _joint_speed_ratio(
    prev_clip: ClipAsset,
    next_clip: ClipAsset,
    transition_clip: ClipAsset,
    joint_index: int,
) -> float:
    prev_series = _normalize_joint_positions(prev_clip.arrays["pose_3d"], joint_index)
    next_series = _normalize_joint_positions(next_clip.arrays["pose_3d"], joint_index)
    transition_series = _normalize_joint_positions(transition_clip.arrays["pose_3d"], joint_index)

    prev_deltas = np.linalg.norm(np.diff(prev_series[-TAIL_SAMPLES:], axis=0), axis=1) if prev_series.shape[0] > 1 else np.zeros(1, dtype=np.float32)
    next_deltas = np.linalg.norm(np.diff(next_series[:TAIL_SAMPLES], axis=0), axis=1) if next_series.shape[0] > 1 else np.zeros(1, dtype=np.float32)
    baseline = max(float(prev_deltas.max(initial=0.0)), float(next_deltas.max(initial=0.0)), 1e-4)

    transition_deltas = np.linalg.norm(np.diff(transition_series, axis=0), axis=1) if transition_series.shape[0] > 1 else np.zeros(1, dtype=np.float32)
    return float(transition_deltas.max(initial=0.0) / baseline)


def evaluate_transition_quality(prev_clip: ClipAsset, next_clip: ClipAsset, transition_clip: ClipAsset) -> dict[str, Any]:
    failed_checks: list[str] = []
    overshoot_details: list[tuple[str, float, str]] = []
    max_speed_ratio = 0.0
    terminal_discontinuity = 0.0

    for joint_name, joint_index, joint_kind in TRANSITION_CHECK_JOINTS:
        transition_series = _normalize_joint_positions(transition_clip.arrays["pose_3d"], joint_index)
        prev_point = _normalize_joint_positions(prev_clip.arrays["pose_3d"][-1:][..., :], joint_index)[0]
        next_point = _normalize_joint_positions(next_clip.arrays["pose_3d"][:1][..., :], joint_index)[0]
        margin = JOINT_MARGIN_BY_KIND[joint_kind]
        lower = np.minimum(prev_point, next_point) - margin
        upper = np.maximum(prev_point, next_point) + margin
        low_delta = np.maximum(lower[None, :] - transition_series, 0.0)
        high_delta = np.maximum(transition_series - upper[None, :], 0.0)
        overshoot = np.maximum(low_delta, high_delta)
        if float(overshoot.max(initial=0.0)) > 0.0:
            flat_index = int(np.argmax(overshoot))
            axis_index = flat_index % 3
            axis_name = ("x", "y", "z")[axis_index]
            overshoot_details.append((joint_name, float(overshoot.max()), axis_name))

        max_speed_ratio = max(max_speed_ratio, _joint_speed_ratio(prev_clip, next_clip, transition_clip, joint_index))
        next_start = _normalize_joint_positions(next_clip.arrays["pose_3d"][:1], joint_index)[0]
        transition_end = transition_series[-1]
        terminal_discontinuity = max(
            terminal_discontinuity,
            float(np.linalg.norm(transition_end - next_start)),
        )

    left_transition = _normalize_joint_positions(transition_clip.arrays["pose_3d"], POSE_LEFT_WRIST_INDEX)
    right_transition = _normalize_joint_positions(transition_clip.arrays["pose_3d"], POSE_RIGHT_WRIST_INDEX)
    left_prev = _normalize_joint_positions(prev_clip.arrays["pose_3d"][-1:], POSE_LEFT_WRIST_INDEX)[0]
    right_prev = _normalize_joint_positions(prev_clip.arrays["pose_3d"][-1:], POSE_RIGHT_WRIST_INDEX)[0]
    left_next = _normalize_joint_positions(next_clip.arrays["pose_3d"][:1], POSE_LEFT_WRIST_INDEX)[0]
    right_next = _normalize_joint_positions(next_clip.arrays["pose_3d"][:1], POSE_RIGHT_WRIST_INDEX)[0]
    transition_spread = np.abs(left_transition[:, 0]) + np.abs(right_transition[:, 0])
    endpoint_spread = max(np.abs(left_prev[0]) + np.abs(right_prev[0]), np.abs(left_next[0]) + np.abs(right_next[0]))
    bilateral_spread_increase = float(np.maximum(transition_spread - (endpoint_spread + BILATERAL_SPREAD_MARGIN), 0.0).max(initial=0.0))

    if overshoot_details:
        failed_checks.append("overshoot")
    if max_speed_ratio > SPEED_RATIO_LIMIT:
        failed_checks.append("speed")
    if terminal_discontinuity > TERMINAL_DISCONTINUITY_LIMIT:
        failed_checks.append("terminal")
    if bilateral_spread_increase > 0.0:
        failed_checks.append("bilateral_spread")

    if overshoot_details:
        worst_joint, worst_overshoot, worst_axis = max(overshoot_details, key=lambda item: item[1])
    else:
        worst_joint, worst_overshoot, worst_axis = "", 0.0, "x"

    return {
        "passed": not failed_checks,
        "failed_checks": failed_checks,
        "max_overshoot": float(worst_overshoot),
        "max_overshoot_joint": worst_joint,
        "max_overshoot_axis": worst_axis,
        "max_speed_ratio": float(max_speed_ratio),
        "terminal_discontinuity": float(terminal_discontinuity),
        "bilateral_spread_increase": float(bilateral_spread_increase),
    }


def _build_transition_clip(
    prev_clip: ClipAsset,
    next_clip: ClipAsset,
    transition_frames: int,
    clamp_scale: float,
    method: str,
) -> ClipAsset:
    arrays: dict[str, np.ndarray] = {}
    for key, prev_array in prev_clip.arrays.items():
        next_array = next_clip.arrays[key]
        interpolated, spatial_dims = _interpolate_frames(prev_array, next_array, transition_frames, method)

        if spatial_dims == 3:
            prev_prev = prev_array[-2] if prev_array.shape[0] > 1 else prev_array[-1]
            next_next = next_array[1] if next_array.shape[0] > 1 else next_array[0]
            limits = _estimate_limit(prev_array[-1], prev_prev, next_array[0], next_next)
            interpolated = _apply_velocity_clamp(interpolated, limits, spatial_dims)

        arrays[key] = interpolated

    arrays["pose_3d"], arrays["left_hand_3d"] = _apply_wrist_anchor(
        arrays["pose_3d"],
        arrays["left_hand_3d"],
        prev_clip.arrays["pose_3d"][-1],
        next_clip.arrays["pose_3d"][0],
        prev_clip.arrays["left_hand_3d"][-1],
        next_clip.arrays["left_hand_3d"][0],
        POSE_LEFT_WRIST_INDEX,
        clamp_scale,
    )
    arrays["pose_3d"], arrays["right_hand_3d"] = _apply_wrist_anchor(
        arrays["pose_3d"],
        arrays["right_hand_3d"],
        prev_clip.arrays["pose_3d"][-1],
        next_clip.arrays["pose_3d"][0],
        prev_clip.arrays["right_hand_3d"][-1],
        next_clip.arrays["right_hand_3d"][0],
        POSE_RIGHT_WRIST_INDEX,
        clamp_scale,
    )
    arrays["pose_3d"], clamp_info = _apply_normalized_constraints(
        arrays["pose_3d"],
        prev_clip.arrays["pose_3d"][-1:][0],
        next_clip.arrays["pose_3d"][:1][0],
        clamp_scale,
    )

    return replace(
        prev_clip,
        id=f"{prev_clip.label}__{next_clip.label}__generated",
        label=f"{prev_clip.label}->{next_clip.label}",
        source="transition",
        path=None,
        arrays=arrays,
        meta={
            "transition_clamp_info": clamp_info,
            "transition_frame_count": transition_frames,
            "transition_clamp_scale": clamp_scale,
            "transition_method": method,
        },
    )


def _with_transition_diagnostics(clip: ClipAsset, attempts: list[dict[str, Any]]) -> ClipAsset:
    final_attempt = attempts[-1]
    diagnostics = {
        "attempts": attempts,
        "final_strategy": final_attempt["strategy"],
        "retry_count": sum(1 for attempt in attempts if attempt["strategy"] == "strong-clamp"),
        "fallback_count": 1 if final_attempt["strategy"] == "short-transition" else 0,
        "quality_failures": sum(1 for attempt in attempts if not attempt["quality"]["passed"]),
        "passed": bool(final_attempt["quality"]["passed"]),
    }
    meta = dict(clip.meta or {})
    meta["transition_diagnostics"] = diagnostics
    return replace(clip, meta=meta)


def generate_transition(
    prev_clip: ClipAsset,
    next_clip: ClipAsset,
    method: TransitionMethod = "smoothstep",
    transition_frames: int | None = None,
    allow_fallback: bool = True,
) -> ClipAsset:
    attempts: list[dict[str, Any]] = []
    if method not in TRANSITION_METHODS:
        raise ValueError(f"Unsupported transition method: {method}")

    base_frames = int(transition_frames) if transition_frames is not None else _resolve_transition_frames(prev_clip, next_clip)
    if base_frames <= 0:
        raise ValueError("transition_frames must be positive")

    base_clip = _build_transition_clip(prev_clip, next_clip, base_frames, clamp_scale=1.0, method=method)
    base_quality = evaluate_transition_quality(prev_clip, next_clip, base_clip)
    attempts.append(
        {
            "strategy": "base",
            "method": method,
            "frame_count": base_frames,
            "quality": base_quality,
        }
    )
    if base_quality["passed"] or not allow_fallback:
        return _with_transition_diagnostics(base_clip, attempts)

    strong_clip = _build_transition_clip(prev_clip, next_clip, base_frames, clamp_scale=STRONG_CLAMP_SCALE, method=method)
    strong_quality = evaluate_transition_quality(prev_clip, next_clip, strong_clip)
    attempts.append(
        {
            "strategy": "strong-clamp",
            "method": method,
            "frame_count": base_frames,
            "quality": strong_quality,
        }
    )
    if strong_quality["passed"] or transition_frames is not None:
        return _with_transition_diagnostics(strong_clip, attempts)

    short_frames = _resolve_short_transition_frames(prev_clip, next_clip)
    short_clip = _build_transition_clip(prev_clip, next_clip, short_frames, clamp_scale=STRONG_CLAMP_SCALE, method=method)
    short_quality = evaluate_transition_quality(prev_clip, next_clip, short_clip)
    attempts.append(
        {
            "strategy": "short-transition",
            "method": method,
            "frame_count": short_frames,
            "quality": short_quality,
        }
    )
    return _with_transition_diagnostics(short_clip, attempts)
