from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from runtime.speech_to_sign.keypoint_interpolator.composer import compose_json_clips
from runtime.speech_to_sign.keypoint_interpolator.schemas import ClipAsset, SegmentTrace


TARGET_FPS = 30
TRANSITION_FRAME_COUNT = 12
WORD_KEYPOINT_DICTIONARY_ROOT = Path(__file__).resolve().parents[2] / "data" / "word_dic"

PEOPLE_TO_ARRAY_SPECS = {
    "pose_keypoints_2d": ("pose_2d", 3),
    "pose_keypoints_3d": ("pose_3d", 4),
    "hand_left_keypoints_2d": ("left_hand_2d", 3),
    "hand_left_keypoints_3d": ("left_hand_3d", 4),
    "hand_right_keypoints_2d": ("right_hand_2d", 3),
    "hand_right_keypoints_3d": ("right_hand_3d", 4),
    "face_keypoints_2d": ("face_2d", 3),
    "face_keypoints_3d": ("face_3d", 4),
}
ARRAY_TO_PEOPLE_FIELDS = {
    internal_name: field_name
    for field_name, (internal_name, _dims) in PEOPLE_TO_ARRAY_SPECS.items()
}


class ClipLoadError(ValueError):
    pass


def _load_json_object(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ClipLoadError(f"Clip JSON must be an object: {path}")
    return payload


def _as_frame_array(value: Any, field_name: str, dims: int, path: Path, frame_index: int) -> np.ndarray:
    if not isinstance(value, list):
        raise ClipLoadError(f"Frame {frame_index} missing {field_name}: {path}")
    if not value:
        raise ClipLoadError(f"Frame {frame_index} has empty {field_name}: {path}")
    if len(value) % dims != 0:
        raise ClipLoadError(f"Frame {frame_index} has invalid {field_name} length: {path}")
    if not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
        raise ClipLoadError(f"Frame {frame_index} has non-numeric {field_name}: {path}")

    array = np.asarray(value, dtype=np.float32).reshape(-1, dims)
    if not np.isfinite(array).all():
        raise ClipLoadError(f"Frame {frame_index} has non-finite {field_name}: {path}")
    return array


def _source_path_from_payload(payload: dict[str, Any], path: Path) -> str:
    source = payload.get("source")
    if isinstance(source, dict):
        source_path = source.get("source_path")
        if isinstance(source_path, str) and source_path:
            return source_path
    return str(path)


def _load_clip(gloss: str, dictionary_root: Path | None = None) -> ClipAsset:
    dictionary_root = dictionary_root or WORD_KEYPOINT_DICTIONARY_ROOT
    path = dictionary_root / f"{gloss}.json"
    if not path.exists():
        raise ClipLoadError(f"Missing keypoint clip: {path}")

    payload = _load_json_object(path)
    if payload.get("schema_version") != "sign-keypoint-clip/v1":
        raise ClipLoadError(f"Unsupported clip schema: {path}")

    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        raise ClipLoadError(f"Clip has no frames: {path}")

    try:
        fps = int(payload.get("fps") or TARGET_FPS)
    except (TypeError, ValueError) as exc:
        raise ClipLoadError(f"Invalid fps: {path}") from exc
    if fps <= 0:
        raise ClipLoadError(f"Invalid fps: {path}")

    collected: dict[str, list[np.ndarray]] = {
        internal_name: []
        for internal_name in ARRAY_TO_PEOPLE_FIELDS
    }
    for frame_index, frame in enumerate(raw_frames):
        if not isinstance(frame, dict):
            raise ClipLoadError(f"Frame {frame_index} is not an object: {path}")
        people = frame.get("people")
        if not isinstance(people, dict):
            raise ClipLoadError(f"Frame {frame_index} missing people: {path}")

        for field_name, (internal_name, dims) in PEOPLE_TO_ARRAY_SPECS.items():
            collected[internal_name].append(
                _as_frame_array(people.get(field_name), field_name, dims, path, frame_index)
            )

    arrays: dict[str, np.ndarray] = {}
    for internal_name, frames in collected.items():
        try:
            arrays[internal_name] = np.stack(frames).astype(np.float32, copy=False)
        except ValueError as exc:
            raise ClipLoadError(f"Inconsistent {ARRAY_TO_PEOPLE_FIELDS[internal_name]} length: {path}") from exc

    frame_count = int(next(iter(arrays.values())).shape[0])
    loaded_gloss = str(payload.get("gloss") or gloss)
    return ClipAsset(
        id=loaded_gloss,
        label=loaded_gloss,
        fps=fps,
        source="word",
        path=path,
        arrays=arrays,
        meta={
            "source": "sign-keypoint-clip",
            "source_path": _source_path_from_payload(payload, path),
            "trim_start_frame": 0,
            "trim_end_frame": frame_count - 1,
        },
    )


def _array_shapes(clip: ClipAsset) -> dict[str, tuple[int, ...]]:
    return {
        key: tuple(value.shape[1:])
        for key, value in clip.arrays.items()
    }


def _empty_payload(glosses: list[str]) -> dict[str, Any]:
    return {
        "schema_version": "sign-sentence-keypoints/v1",
        "fps": TARGET_FPS,
        "glosses": glosses,
        "segments": [],
        "frames": [],
    }


def _segment_source(segment: SegmentTrace, clip_by_label: dict[str, ClipAsset]) -> str:
    if segment.is_transition:
        return "generated:smoothstep"
    clip = clip_by_label.get(segment.label)
    if clip is None:
        return segment.kind
    meta = clip.meta or {}
    source_path = meta.get("source_path")
    return str(source_path or clip.path or segment.kind)


def _segments_to_payload_segments(
    segments: list[SegmentTrace],
    clip_by_label: dict[str, ClipAsset],
) -> list[dict[str, Any]]:
    payload_segments: list[dict[str, Any]] = []
    for segment in segments:
        payload_segment: dict[str, Any] = {
            "gloss": segment.label,
            "start_frame": segment.start_frame,
            "end_frame": segment.end_frame,
            "source": _segment_source(segment, clip_by_label),
        }
        if segment.is_transition:
            payload_segment["is_transition"] = True
        payload_segments.append(payload_segment)
    return payload_segments


def _frames_from_arrays(arrays: dict[str, np.ndarray]) -> list[dict[str, Any]]:
    frame_count = int(next(iter(arrays.values())).shape[0])
    frames: list[dict[str, Any]] = []
    for frame_index in range(frame_count):
        people: dict[str, list[float]] = {}
        for internal_name, field_name in ARRAY_TO_PEOPLE_FIELDS.items():
            array = arrays[internal_name][frame_index]
            if not np.isfinite(array).all():
                raise ValueError(f"Composed frame {frame_index} has non-finite {field_name}")
            people[field_name] = array.astype(float, copy=False).reshape(-1).tolist()
        frames.append({"frame_index": frame_index, "people": people})
    return frames


def _compose_payload(glosses: list[str], clips: list[ClipAsset]) -> dict[str, Any]:
    if not clips:
        return _empty_payload(glosses)

    arrays, segments, _stats = compose_json_clips(
        clips,
        target_fps=TARGET_FPS,
        transition_frames=TRANSITION_FRAME_COUNT,
        transition_method="smoothstep",
    )
    clip_by_label = {clip.label: clip for clip in clips}
    payload = _empty_payload(glosses)
    payload["segments"] = _segments_to_payload_segments(segments, clip_by_label)
    payload["frames"] = _frames_from_arrays(arrays)
    return payload


def glosses_to_keypoint_payload(glosses: list[str]) -> dict[str, Any]:
    clips: list[ClipAsset] = []
    resolved: list[str] = []
    missing: list[str] = []
    expected_shapes: dict[str, tuple[int, ...]] | None = None

    for gloss in glosses:
        if not isinstance(gloss, str) or not gloss.strip():
            missing.append(str(gloss))
            continue

        normalized_gloss = gloss.strip()
        try:
            clip = _load_clip(normalized_gloss)
        except (OSError, json.JSONDecodeError, ClipLoadError):
            missing.append(normalized_gloss)
            continue

        shapes = _array_shapes(clip)
        if expected_shapes is None:
            expected_shapes = shapes
        elif shapes != expected_shapes:
            missing.append(normalized_gloss)
            continue

        clips.append(clip)
        resolved.append(normalized_gloss)

    try:
        payload = _compose_payload(glosses, clips)
    except (KeyError, ValueError, FloatingPointError):
        missing = [*missing, *resolved]
        resolved = []
        payload = _empty_payload(glosses)

    coverage = round(len(resolved) / len(glosses), 3) if glosses else 0.0
    return {
        "payload": payload,
        "resolved_glosses": resolved,
        "missing_glosses": missing,
        "coverage": coverage,
    }
