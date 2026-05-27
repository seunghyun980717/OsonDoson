"""Segment-aware EMA smoothing with transition bleed protection."""

from __future__ import annotations

import numpy as np

from .schemas import SegmentTrace


SOURCE_GUARD_FRAMES = 3


def _ema(frames: np.ndarray, alpha_by_frame: np.ndarray, reset_mask: np.ndarray | None = None) -> np.ndarray:
    result = frames.copy()
    for index in range(1, result.shape[0]):
        if reset_mask is not None and bool(reset_mask[index]):
            result[index] = frames[index]
            continue
        alpha = float(alpha_by_frame[index])
        result[index] = (alpha * result[index]) + ((1.0 - alpha) * result[index - 1])
    return result


def _alpha_schedule(
    frame_count: int,
    segments: list[SegmentTrace],
    default_alpha: float,
    transition_alpha: float,
    hold_alpha: float,
    source_guard_alpha: float,
    source_guard_frames: int = SOURCE_GUARD_FRAMES,
) -> tuple[np.ndarray, np.ndarray]:
    schedule = np.full(frame_count, default_alpha, dtype=np.float32)
    reset_mask = np.zeros(frame_count, dtype=bool)

    previous_segment: SegmentTrace | None = None
    for segment in segments:
        frame_slice = slice(segment.start_frame, segment.end_frame + 1)
        if segment.kind in {"generated-transition", "cached-transition"}:
            schedule[frame_slice] = transition_alpha
        elif segment.kind == "boundary-hold":
            schedule[frame_slice] = hold_alpha

        if (
            previous_segment is not None
            and previous_segment.kind in {"generated-transition", "cached-transition"}
            and segment.kind == "source"
        ):
            reset_mask[segment.start_frame] = True
            guard_end = min(segment.end_frame + 1, segment.start_frame + source_guard_frames)
            schedule[segment.start_frame:guard_end] = source_guard_alpha

        previous_segment = segment

    return schedule, reset_mask


def smooth_sequence(
    arrays: dict[str, np.ndarray],
    segments: list[SegmentTrace],
    body_alpha: float = 0.45,
    hand_alpha: float = 0.7,
    face_alpha: float = 0.55,
) -> dict[str, np.ndarray]:
    frame_count = next(iter(arrays.values())).shape[0]
    body_schedule, body_reset = _alpha_schedule(
        frame_count,
        segments,
        default_alpha=body_alpha,
        transition_alpha=0.32,
        hold_alpha=1.0,
        source_guard_alpha=0.88,
    )
    hand_schedule, hand_reset = _alpha_schedule(
        frame_count,
        segments,
        default_alpha=hand_alpha,
        transition_alpha=0.5,
        hold_alpha=1.0,
        source_guard_alpha=0.92,
    )
    face_schedule, face_reset = _alpha_schedule(
        frame_count,
        segments,
        default_alpha=face_alpha,
        transition_alpha=0.38,
        hold_alpha=1.0,
        source_guard_alpha=0.8,
    )

    smoothed = dict(arrays)
    smoothed["pose_3d"] = _ema(arrays["pose_3d"], body_schedule, body_reset)
    smoothed["pose_2d"] = _ema(arrays["pose_2d"], body_schedule, body_reset)
    smoothed["left_hand_3d"] = _ema(arrays["left_hand_3d"], hand_schedule, hand_reset)
    smoothed["left_hand_2d"] = _ema(arrays["left_hand_2d"], hand_schedule, hand_reset)
    smoothed["right_hand_3d"] = _ema(arrays["right_hand_3d"], hand_schedule, hand_reset)
    smoothed["right_hand_2d"] = _ema(arrays["right_hand_2d"], hand_schedule, hand_reset)
    smoothed["face_2d"] = _ema(arrays["face_2d"], face_schedule, face_reset)
    smoothed["face_3d"] = _ema(arrays["face_3d"], face_schedule, face_reset)
    return smoothed
