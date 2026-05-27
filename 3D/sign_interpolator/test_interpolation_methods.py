"""Standalone checks for transition interpolation methods."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sign_interpolator.schemas import ClipAsset
    from sign_interpolator.transition_generator import TRANSITION_METHODS, generate_transition
else:
    from .schemas import ClipAsset
    from .transition_generator import TRANSITION_METHODS, generate_transition


def _make_array(frame_count: int, point_count: int, dims: int, offset: float) -> np.ndarray:
    frames = np.zeros((frame_count, point_count, dims), dtype=np.float32)
    for frame_index in range(frame_count):
        t = frame_index / max(1, frame_count - 1)
        frames[frame_index, :, 0] = offset + t + np.linspace(0.0, 0.2, point_count)
        frames[frame_index, :, 1] = offset * 0.5 + t * 0.3
        if dims >= 4:
            frames[frame_index, :, 2] = offset * -0.2 + t * 0.15
            frames[frame_index, :, 3] = 0.9
        else:
            frames[frame_index, :, 2] = 0.9
    return frames


def _make_clip(label: str, offset: float) -> ClipAsset:
    frame_count = 18
    return ClipAsset(
        id=label,
        label=label,
        fps=30,
        source="word",
        path=None,
        arrays={
            "pose_3d": _make_array(frame_count, 25, 4, offset),
            "left_hand_3d": _make_array(frame_count, 21, 4, offset + 0.1),
            "right_hand_3d": _make_array(frame_count, 21, 4, offset + 0.2),
            "face_3d": _make_array(frame_count, 68, 4, offset + 0.3),
            "pose_2d": _make_array(frame_count, 25, 3, offset),
            "left_hand_2d": _make_array(frame_count, 21, 3, offset + 0.1),
            "right_hand_2d": _make_array(frame_count, 21, 3, offset + 0.2),
            "face_2d": _make_array(frame_count, 68, 3, offset + 0.3),
        },
    )


class InterpolationMethodTests(unittest.TestCase):
    def test_methods_generate_fixed_length_finite_shapes(self) -> None:
        prev_clip = _make_clip("prev", 0.0)
        next_clip = _make_clip("next", 1.0)

        for method in sorted(TRANSITION_METHODS):
            with self.subTest(method=method):
                transition = generate_transition(
                    prev_clip,
                    next_clip,
                    method=method,  # type: ignore[arg-type]
                    transition_frames=12,
                    allow_fallback=False,
                )
                self.assertEqual(transition.frame_count, 12)
                for key, value in transition.arrays.items():
                    self.assertEqual(value.shape[1:], prev_clip.arrays[key].shape[1:])
                    self.assertTrue(np.isfinite(value).all())
                    confidence_index = 3 if value.shape[-1] >= 4 else 2
                    confidence = value[:, :, confidence_index]
                    self.assertGreaterEqual(float(confidence.min()), 0.0)
                    self.assertLessEqual(float(confidence.max()), 1.0)


if __name__ == "__main__":
    unittest.main()
