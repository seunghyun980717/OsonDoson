"""FastAPI-facing service entrypoint."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .composer import compose_sequence
from .schemas import ComposeRequest, ComposeResult, FrameData, VERSION
from .transition_selector import TransitionSelector


_SELECTOR = TransitionSelector(max_entries=32)


def _flatten(array: np.ndarray) -> list[float]:
    return array.reshape(-1).astype(np.float32).tolist()


def _frame_list_from_arrays(arrays: dict[str, np.ndarray]) -> list[FrameData]:
    frame_count = next(iter(arrays.values())).shape[0]
    frames: list[FrameData] = []
    for index in range(frame_count):
        frames.append(
            {
                "version": VERSION,
                "camparam": {},
                "people": {
                    "person_id": -1,
                    "pose_keypoints_2d": _flatten(arrays["pose_2d"][index]),
                    "pose_keypoints_3d": _flatten(arrays["pose_3d"][index]),
                    "hand_left_keypoints_2d": _flatten(arrays["left_hand_2d"][index]),
                    "hand_left_keypoints_3d": _flatten(arrays["left_hand_3d"][index]),
                    "hand_right_keypoints_2d": _flatten(arrays["right_hand_2d"][index]),
                    "hand_right_keypoints_3d": _flatten(arrays["right_hand_3d"][index]),
                    "face_keypoints_2d": _flatten(arrays["face_2d"][index]),
                    "face_keypoints_3d": _flatten(arrays["face_3d"][index]),
                },
            }
        )
    return frames


def compose_words(request: ComposeRequest, asset_root: Path) -> ComposeResult:
    arrays, segments, stats = compose_sequence(request, asset_root, _SELECTOR)
    return ComposeResult(
        frames=_frame_list_from_arrays(arrays),
        segments=segments,
        stats=stats,
    )
