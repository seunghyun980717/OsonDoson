"""Public schemas and internal clip containers for the interpolation package."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
from typing_extensions import NotRequired, TypedDict

try:
    from pydantic import BaseModel
except ModuleNotFoundError:  # pragma: no cover - local fallback for environments without FastAPI deps
    class BaseModel:
        """Tiny fallback used only when pydantic is unavailable locally."""

        def __init__(self, **kwargs: Any) -> None:
            annotations = getattr(self, "__annotations__", {})
            for field_name in annotations:
                if field_name in kwargs:
                    value = kwargs[field_name]
                else:
                    value = getattr(type(self), field_name, None)
                setattr(self, field_name, value)

        def model_dump(self) -> dict[str, Any]:
            return {
                key: getattr(self, key)
                for key in getattr(self, "__annotations__", {})
            }


TransitionMethod = Literal["linear", "smoothstep", "hermite", "catmull_rom", "bezier"]


class PeopleFrame(TypedDict):
    person_id: int
    pose_keypoints_2d: list[float]
    pose_keypoints_3d: list[float]
    hand_left_keypoints_2d: list[float]
    hand_left_keypoints_3d: list[float]
    hand_right_keypoints_2d: list[float]
    hand_right_keypoints_3d: list[float]
    face_keypoints_2d: list[float]
    face_keypoints_3d: list[float]


class FrameData(TypedDict):
    version: float
    people: PeopleFrame
    camparam: NotRequired[dict[str, Any]]


class ComposeRequest(BaseModel):
    word_ids: list[str]
    target_fps: Literal[20, 24, 30] = 30
    transition_policy: Literal["cached-first", "generated-only"] = "cached-first"
    transition_method: TransitionMethod = "smoothstep"
    transition_frames: int | None = None
    boundary_policy: Literal["direct-hold"] = "direct-hold"
    start_hold_frames: int = 3
    end_hold_frames: int = 4
    total_frame_hint: int | None = None


class PoseSummary(BaseModel):
    pose_class: Literal[
        "rest-center",
        "left-extended",
        "right-extended",
        "both-raised",
        "face-near",
        "torso-near",
        "unknown",
    ]
    dominant_hand: Literal["left", "right", "both"]
    left_wrist_anchor: tuple[float, float, float]
    right_wrist_anchor: tuple[float, float, float]
    signing_space_offset: tuple[float, float, float]


class SegmentTrace(BaseModel):
    kind: Literal["source", "neutral", "boundary-hold", "cached-transition", "generated-transition"]
    label: str
    start_frame: int
    end_frame: int
    is_transition: bool
    stroke_range: tuple[int, int] | None = None


class ComposeStats(BaseModel):
    source_clip_count: int
    generated_transition_count: int
    output_frame_count: int
    boundary_hold_frame_count: int = 0
    cache_hits: int = 0
    transition_retry_count: int = 0
    transition_fallback_count: int = 0
    transition_quality_failures: int = 0
    transition_diagnostics: list[dict[str, Any]] | None = None


class ComposeResult(BaseModel):
    frames: list[FrameData]
    segments: list[SegmentTrace]
    stats: ComposeStats


@dataclass(slots=True)
class ClipAsset:
    id: str
    label: str
    fps: int
    source: Literal["word", "phrase", "transition", "neutral"]
    path: Path | None
    arrays: dict[str, np.ndarray]
    start_pose: PoseSummary | None = None
    end_pose: PoseSummary | None = None
    meta: dict[str, Any] | None = None

    @property
    def frame_count(self) -> int:
        first = next(iter(self.arrays.values()))
        return int(first.shape[0])


KEY_REQUIRED = ("pose_3d", "left_hand_3d", "right_hand_3d", "face_2d", "face_3d")
KEY_OPTIONAL = ("pose_2d", "left_hand_2d", "right_hand_2d")
ALL_KEYS = KEY_REQUIRED + KEY_OPTIONAL

POSE_LEFT_SHOULDER_INDEX = 5
POSE_RIGHT_SHOULDER_INDEX = 2
POSE_LEFT_WRIST_INDEX = 7
POSE_RIGHT_WRIST_INDEX = 4
POSE_LEFT_ELBOW_INDEX = 6
POSE_RIGHT_ELBOW_INDEX = 3
LEFT_HAND_WRIST_INDEX = 0
RIGHT_HAND_WRIST_INDEX = 0

VERSION = 1.3
