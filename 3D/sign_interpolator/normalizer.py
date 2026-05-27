"""Clip normalization, FPS resampling, and face fallback logic."""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable

import numpy as np

from .schemas import (
    LEFT_HAND_WRIST_INDEX,
    POSE_LEFT_SHOULDER_INDEX,
    POSE_LEFT_WRIST_INDEX,
    POSE_RIGHT_SHOULDER_INDEX,
    POSE_RIGHT_WRIST_INDEX,
    RIGHT_HAND_WRIST_INDEX,
    ClipAsset,
    PoseSummary,
)


DEFAULT_TRIM_START_RATIO = 0.336
DEFAULT_TRIM_END_RATIO = 0.735
DEFAULT_TRIM_MIN_FRAMES = 16


def _resample_array(array: np.ndarray, target_frames: int) -> np.ndarray:
    if array.shape[0] == target_frames:
        return array.astype(np.float32, copy=True)
    if array.shape[0] == 1:
        return np.repeat(array.astype(np.float32), target_frames, axis=0)

    source_x = np.linspace(0.0, 1.0, num=array.shape[0], dtype=np.float32)
    target_x = np.linspace(0.0, 1.0, num=target_frames, dtype=np.float32)
    flat = array.reshape(array.shape[0], -1)
    result = np.empty((target_frames, flat.shape[1]), dtype=np.float32)
    for idx in range(flat.shape[1]):
        result[:, idx] = np.interp(target_x, source_x, flat[:, idx]).astype(np.float32)
    return result.reshape(target_frames, *array.shape[1:])


def _target_frame_count(frame_count: int, source_fps: int, target_fps: int) -> int:
    if frame_count <= 1:
        return 1
    duration = (frame_count - 1) / float(source_fps)
    return max(1, int(round(duration * target_fps)) + 1)


def _confidence_channel(array: np.ndarray) -> np.ndarray:
    if array.shape[-1] == 3:
        return array[:, :, 2]
    if array.shape[-1] >= 4:
        return array[:, :, 3]
    return np.ones(array.shape[:2], dtype=np.float32)


def _frame_validity(face_2d: np.ndarray, face_3d: np.ndarray) -> np.ndarray:
    conf_2d = _confidence_channel(face_2d).max(axis=1)
    conf_3d = _confidence_channel(face_3d).max(axis=1)
    return (conf_2d > 0) | (conf_3d > 0)


def _nearest_valid_indices(valid: np.ndarray) -> np.ndarray:
    valid_idx = np.where(valid)[0]
    if valid_idx.size == 0:
        return np.full(valid.shape[0], -1, dtype=np.int32)
    nearest = np.empty(valid.shape[0], dtype=np.int32)
    for idx in range(valid.shape[0]):
        nearest[idx] = int(valid_idx[np.argmin(np.abs(valid_idx - idx))])
    return nearest


def extract_neutral_face_template(clip: ClipAsset) -> tuple[np.ndarray, np.ndarray] | None:
    face_2d = clip.arrays["face_2d"]
    face_3d = clip.arrays["face_3d"]
    valid = _frame_validity(face_2d, face_3d)
    if not valid.any():
        return None
    first_valid = int(np.where(valid)[0][0])
    return face_2d[first_valid].copy(), face_3d[first_valid].copy()


def _ensure_face(
    arrays: dict[str, np.ndarray],
    neutral_template: tuple[np.ndarray, np.ndarray] | None,
) -> dict[str, np.ndarray]:
    face_2d = arrays["face_2d"].copy()
    face_3d = arrays["face_3d"].copy()
    valid = _frame_validity(face_2d, face_3d)

    if valid.any():
        nearest = _nearest_valid_indices(valid)
        for idx, nearest_idx in enumerate(nearest):
            if nearest_idx >= 0 and not valid[idx]:
                face_2d[idx] = face_2d[nearest_idx]
                face_3d[idx] = face_3d[nearest_idx]
    else:
        if neutral_template is None:
            template_2d = np.zeros_like(face_2d[0])
            template_3d = np.zeros_like(face_3d[0])
            template_2d[:, 2] = 1.0
            template_3d[:, 3] = 1.0
        else:
            template_2d, template_3d = neutral_template
        face_2d[:] = template_2d
        face_3d[:] = template_3d

    arrays["face_2d"] = face_2d
    arrays["face_3d"] = face_3d
    return arrays


def _dominant_hand_from_motion(left_hand_3d: np.ndarray, right_hand_3d: np.ndarray) -> str:
    left_motion = float(np.linalg.norm(np.diff(left_hand_3d[:, 0, :3], axis=0), axis=1).sum())
    right_motion = float(np.linalg.norm(np.diff(right_hand_3d[:, 0, :3], axis=0), axis=1).sum())
    if abs(left_motion - right_motion) < 1e-5:
        return "both"
    return "left" if left_motion > right_motion else "right"


def _canonical_wrist(pose_frame: np.ndarray, hand_frame: np.ndarray, wrist_index: int) -> np.ndarray:
    pose_wrist = pose_frame[wrist_index, :3]
    hand_wrist = hand_frame[0, :3]
    return (0.35 * pose_wrist) + (0.65 * hand_wrist)


def _classify_pose(pose_3d: np.ndarray) -> str:
    left = pose_3d[POSE_LEFT_WRIST_INDEX, :3]
    right = pose_3d[POSE_RIGHT_WRIST_INDEX, :3]
    if left[1] > 0.2 and right[1] > 0.2:
        return "both-raised"
    if left[1] > 0.25 or right[1] > 0.25:
        return "face-near"
    if left[1] > 0.05 and right[1] > 0.05:
        return "torso-near"
    if left[0] < -0.25:
        return "left-extended"
    if right[0] > 0.25:
        return "right-extended"
    return "rest-center"


def _make_pose_summary(
    pose_frame: np.ndarray,
    left_hand_frame: np.ndarray,
    right_hand_frame: np.ndarray,
    dominant_hand: str,
    signing_space_offset: np.ndarray,
) -> PoseSummary:
    left_anchor = _canonical_wrist(pose_frame, left_hand_frame, POSE_LEFT_WRIST_INDEX)
    right_anchor = _canonical_wrist(pose_frame, right_hand_frame, POSE_RIGHT_WRIST_INDEX)
    return PoseSummary(
        pose_class=_classify_pose(pose_frame),
        dominant_hand=dominant_hand,  # type: ignore[arg-type]
        left_wrist_anchor=tuple(float(v) for v in left_anchor),
        right_wrist_anchor=tuple(float(v) for v in right_anchor),
        signing_space_offset=tuple(float(v) for v in signing_space_offset),
    )


def _root_relative_xyz(arrays: dict[str, np.ndarray]) -> tuple[dict[str, np.ndarray], np.ndarray]:
    pose_3d = arrays["pose_3d"].copy()
    shoulders = pose_3d[:, [POSE_RIGHT_SHOULDER_INDEX, POSE_LEFT_SHOULDER_INDEX], :3]
    shoulder_center = shoulders.mean(axis=1)
    signing_space_offset = np.median(shoulder_center, axis=0).astype(np.float32)

    for key in ("pose_3d", "left_hand_3d", "right_hand_3d", "face_3d"):
        arrays[key] = arrays[key].copy()
        arrays[key][:, :, :3] -= shoulder_center[:, None, :]

    return arrays, signing_space_offset


def resolve_trim_bounds(
    frame_count: int,
    start_frame: int | None = None,
    end_frame: int | None = None,
    start_ratio: float = DEFAULT_TRIM_START_RATIO,
    end_ratio: float = DEFAULT_TRIM_END_RATIO,
    min_frames: int = DEFAULT_TRIM_MIN_FRAMES,
) -> tuple[int, int]:
    if frame_count <= 0:
        raise ValueError("frame_count must be positive")

    if start_frame is None:
        start_frame = int(round((frame_count - 1) * start_ratio))
    if end_frame is None:
        end_frame = int(round((frame_count - 1) * end_ratio))

    start = max(0, min(int(start_frame), frame_count - 1))
    end = max(0, min(int(end_frame), frame_count - 1))
    if end < start:
        start, end = end, start

    required = max(1, min(min_frames, frame_count))
    current = end - start + 1
    if current >= required:
        return start, end

    deficit = required - current
    left_pad = deficit // 2
    right_pad = deficit - left_pad
    start = max(0, start - left_pad)
    end = min(frame_count - 1, end + right_pad)

    current = end - start + 1
    if current < required:
        remaining = required - current
        if start == 0:
            end = min(frame_count - 1, end + remaining)
        elif end == frame_count - 1:
            start = max(0, start - remaining)

    return start, end


def trim_clip(
    clip: ClipAsset,
    start_frame: int | None = None,
    end_frame: int | None = None,
    start_ratio: float = DEFAULT_TRIM_START_RATIO,
    end_ratio: float = DEFAULT_TRIM_END_RATIO,
    min_frames: int = DEFAULT_TRIM_MIN_FRAMES,
    trim_source: str = "ratio-fallback",
) -> ClipAsset:
    start, end = resolve_trim_bounds(
        clip.frame_count,
        start_frame=start_frame,
        end_frame=end_frame,
        start_ratio=start_ratio,
        end_ratio=end_ratio,
        min_frames=min_frames,
    )
    arrays = {
        key: value[start : end + 1].astype(np.float32, copy=True)
        for key, value in clip.arrays.items()
    }
    meta = dict(clip.meta or {})
    meta.update(
        {
            "resolved_trim_start_frame": int(start),
            "resolved_trim_end_frame": int(end),
            "trim_source": trim_source,
        }
    )
    return replace(
        clip,
        arrays=arrays,
        meta=meta,
    )


def resample_clip_frames(clip: ClipAsset, target_frames: int) -> ClipAsset:
    if target_frames <= 0:
        raise ValueError("target_frames must be positive")
    arrays = {
        key: _resample_array(value, target_frames)
        for key, value in clip.arrays.items()
    }
    meta = dict(clip.meta or {})
    meta["target_frame_count"] = int(target_frames)
    return replace(
        clip,
        arrays=arrays,
        meta=meta,
    )


def normalize_clip(
    clip: ClipAsset,
    target_fps: int,
    neutral_face_template: tuple[np.ndarray, np.ndarray] | None = None,
) -> ClipAsset:
    target_frames = _target_frame_count(clip.frame_count, clip.fps, target_fps)
    arrays = {key: _resample_array(value, target_frames) for key, value in clip.arrays.items()}
    arrays = _ensure_face(arrays, neutral_face_template)
    arrays, signing_space_offset = _root_relative_xyz(arrays)

    dominant_hand = _dominant_hand_from_motion(arrays["left_hand_3d"], arrays["right_hand_3d"])
    start_pose = _make_pose_summary(
        arrays["pose_3d"][0],
        arrays["left_hand_3d"][0],
        arrays["right_hand_3d"][0],
        dominant_hand,
        signing_space_offset,
    )
    end_pose = _make_pose_summary(
        arrays["pose_3d"][-1],
        arrays["left_hand_3d"][-1],
        arrays["right_hand_3d"][-1],
        dominant_hand,
        signing_space_offset,
    )

    return replace(
        clip,
        fps=target_fps,
        arrays=arrays,
        start_pose=start_pose,
        end_pose=end_pose,
    )


def first_neutral_face_template(clips: Iterable[ClipAsset]) -> tuple[np.ndarray, np.ndarray] | None:
    for clip in clips:
        template = extract_neutral_face_template(clip)
        if template is not None:
            return template
    return None
