from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


TARGET_FPS = 30
TRANSITION_FRAME_COUNT = 12
# jetson/backend/app/ai_runtime/runtime/speech_to_sign/gloss_to_keypoints.py 위치 기준
# app/ai_runtime/data/word_dic 경로를 가리키도록 설정
WORD_KEYPOINT_DICTIONARY_ROOT = Path(__file__).resolve().parents[2] / "data" / "word_dic"

KEYPOINT_FIELDS = (
    "pose_keypoints_2d",
    "pose_keypoints_3d",
    "hand_left_keypoints_2d",
    "hand_left_keypoints_3d",
    "hand_right_keypoints_2d",
    "hand_right_keypoints_3d",
    "face_keypoints_2d",
    "face_keypoints_3d",
)


@dataclass(frozen=True)
class WordKeypointClip:
    gloss: str
    path: Path
    fps: int
    frames: list[dict[str, Any]]


class ClipLoadError(ValueError):
    pass


def _load_json_object(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ClipLoadError(f"Clip JSON must be an object: {path}")
    return payload


def _as_number_array(value: Any, field_name: str, path: Path, frame_index: int) -> list[float]:
    if not isinstance(value, list):
        raise ClipLoadError(f"Frame {frame_index} missing {field_name}: {path}")
    if not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
        raise ClipLoadError(f"Frame {frame_index} has non-numeric {field_name}: {path}")
    if not value:
        raise ClipLoadError(f"Frame {frame_index} has empty {field_name}: {path}")
    return [float(item) for item in value]


def _normalize_people(frame: dict[str, Any], path: Path, frame_index: int) -> dict[str, list[float]]:
    people = frame.get("people")
    if not isinstance(people, dict):
        raise ClipLoadError(f"Frame {frame_index} missing people: {path}")
    return {
        field_name: _as_number_array(people.get(field_name), field_name, path, frame_index)
        for field_name in KEYPOINT_FIELDS
    }


def _validate_lengths(frames: list[dict[str, Any]], path: Path) -> None:
    expected: dict[str, int] = {}
    for frame_index, frame in enumerate(frames):
        people = frame["people"]
        for field_name in KEYPOINT_FIELDS:
            length = len(people[field_name])
            previous = expected.setdefault(field_name, length)
            if length != previous:
                raise ClipLoadError(
                    f"Inconsistent {field_name} length at frame {frame_index}: {path}"
                )


def _clip_field_lengths(clip: WordKeypointClip) -> dict[str, int]:
    first_people = clip.frames[0]["people"]
    return {
        field_name: len(first_people[field_name])
        for field_name in KEYPOINT_FIELDS
    }


def _load_clip(gloss: str, dictionary_root: Path | None = None) -> WordKeypointClip:
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

    frames = [
        {"frame_index": index, "people": _normalize_people(frame, path, index)}
        for index, frame in enumerate(raw_frames)
        if isinstance(frame, dict)
    ]
    if len(frames) != len(raw_frames):
        raise ClipLoadError(f"Clip contains invalid frame objects: {path}")

    _validate_lengths(frames, path)
    if fps != TARGET_FPS:
        frames = _resample_frames(frames, fps, TARGET_FPS)

    return WordKeypointClip(
        gloss=str(payload.get("gloss") or gloss),
        path=path,
        fps=TARGET_FPS,
        frames=frames,
    )


def _interpolate_values(prev_values: list[float], next_values: list[float], weight: float) -> list[float]:
    if len(prev_values) != len(next_values):
        raise ClipLoadError("Cannot interpolate keypoints with different lengths")
    inverse = 1.0 - weight
    return [(prev * inverse) + (next_value * weight) for prev, next_value in zip(prev_values, next_values)]


def _interpolate_frame(
    prev_frame: dict[str, Any],
    next_frame: dict[str, Any],
    weight: float,
    frame_index: int,
) -> dict[str, Any]:
    prev_people = prev_frame["people"]
    next_people = next_frame["people"]
    return {
        "frame_index": frame_index,
        "people": {
            field_name: _interpolate_values(prev_people[field_name], next_people[field_name], weight)
            for field_name in KEYPOINT_FIELDS
        },
    }


def _resample_frames(
    frames: list[dict[str, Any]],
    source_fps: int,
    target_fps: int,
) -> list[dict[str, Any]]:
    if source_fps == target_fps or len(frames) <= 1:
        return [_copy_frame(frame, index) for index, frame in enumerate(frames)]

    target_count = max(1, int(round(len(frames) * (target_fps / source_fps))))
    if target_count == 1:
        return [_copy_frame(frames[0], 0)]

    resampled: list[dict[str, Any]] = []
    max_source_index = len(frames) - 1
    for index in range(target_count):
        source_position = index * (max_source_index / (target_count - 1))
        lower_index = int(source_position)
        upper_index = min(max_source_index, lower_index + 1)
        weight = source_position - lower_index
        if upper_index == lower_index:
            resampled.append(_copy_frame(frames[lower_index], index))
        else:
            resampled.append(_interpolate_frame(frames[lower_index], frames[upper_index], weight, index))
    return resampled


def _smoothstep(index: int, transition_frame_count: int) -> float:
    t = index / (transition_frame_count + 1)
    return t * t * (3.0 - (2.0 * t))


def _build_transition_frames(
    prev_clip: WordKeypointClip,
    next_clip: WordKeypointClip,
    start_frame: int,
) -> list[dict[str, Any]]:
    prev_frame = prev_clip.frames[-1]
    next_frame = next_clip.frames[0]
    return [
        _interpolate_frame(
            prev_frame,
            next_frame,
            _smoothstep(index, TRANSITION_FRAME_COUNT),
            start_frame + index - 1,
        )
        for index in range(1, TRANSITION_FRAME_COUNT + 1)
    ]


def _copy_frame(frame: dict[str, Any], frame_index: int) -> dict[str, Any]:
    return {
        "frame_index": frame_index,
        "people": {
            field_name: list(frame["people"][field_name])
            for field_name in KEYPOINT_FIELDS
        },
    }


def _empty_payload(glosses: list[str]) -> dict[str, Any]:
    return {
        "schema_version": "sign-sentence-keypoints/v1",
        "fps": TARGET_FPS,
        "glosses": glosses,
        "segments": [],
        "frames": [],
    }


def _compose_payload(glosses: list[str], clips: list[WordKeypointClip]) -> dict[str, Any]:
    payload = _empty_payload(glosses)
    frames = payload["frames"]
    segments = payload["segments"]

    for index, clip in enumerate(clips):
        if index > 0:
            prev_clip = clips[index - 1]
            transition_start = len(frames)
            transition_frames = _build_transition_frames(prev_clip, clip, transition_start)
            frames.extend(transition_frames)
            segments.append(
                {
                    "gloss": f"{prev_clip.gloss}->{clip.gloss}",
                    "start_frame": transition_start,
                    "end_frame": len(frames) - 1,
                    "source": "generated:smoothstep",
                    "is_transition": True,
                }
            )

        source_start = len(frames)
        for frame in clip.frames:
            frames.append(_copy_frame(frame, len(frames)))
        segments.append(
            {
                "gloss": clip.gloss,
                "start_frame": source_start,
                "end_frame": len(frames) - 1,
                "source": str(clip.path),
            }
        )

    return payload


def glosses_to_keypoint_payload(glosses: list[str]) -> dict[str, Any]:
    clips: list[WordKeypointClip] = []
    resolved: list[str] = []
    missing: list[str] = []

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

        if clips and _clip_field_lengths(clip) != _clip_field_lengths(clips[0]):
            missing.append(normalized_gloss)
            continue

        clips.append(clip)
        resolved.append(normalized_gloss)

    payload = _compose_payload(glosses, clips) if clips else _empty_payload(glosses)
    coverage = round(len(resolved) / len(glosses), 3) if glosses else 0.0
    return {
        "payload": payload,
        "resolved_glosses": resolved,
        "missing_glosses": missing,
        "coverage": coverage,
    }
