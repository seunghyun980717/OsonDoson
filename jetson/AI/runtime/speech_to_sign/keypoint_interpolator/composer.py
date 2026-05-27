"""Generated-only sentence composition for word_dic JSON keypoint clips."""

from __future__ import annotations

from typing import Literal

import numpy as np

from .normalizer import (
    DEFAULT_TRIM_END_RATIO,
    DEFAULT_TRIM_START_RATIO,
    first_neutral_face_template,
    normalize_clip,
    trim_clip,
)
from .schemas import ClipAsset, ComposeStats, SegmentTrace, TransitionMethod
from .smoother import smooth_sequence
from .transition_generator import generate_transition


def _append_arrays(target: dict[str, np.ndarray], source: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    if not target:
        return {key: value.copy() for key, value in source.items()}
    return {key: np.concatenate([target[key], source[key]], axis=0) for key in target.keys()}


def _add_segment(
    segments: list[SegmentTrace],
    kind: Literal["source", "neutral", "boundary-hold", "cached-transition", "generated-transition"],
    label: str,
    start_frame: int,
    frame_count: int,
    is_transition: bool,
) -> None:
    segments.append(
        SegmentTrace(
            kind=kind,
            label=label,
            start_frame=start_frame,
            end_frame=start_frame + frame_count - 1,
            is_transition=is_transition,
            stroke_range=None,
        )
    )


def _trim_source_clip(clip: ClipAsset) -> ClipAsset:
    meta = clip.meta or {}
    start_frame = meta.get("trim_start_frame")
    end_frame = meta.get("trim_end_frame")
    trim_source = str(meta.get("source") or meta.get("trim_source") or "ratio-fallback")
    if start_frame is None or end_frame is None:
        trim_source = "ratio-fallback"
    return trim_clip(
        clip,
        start_frame=start_frame,
        end_frame=end_frame,
        start_ratio=float(meta.get("start_ratio", DEFAULT_TRIM_START_RATIO)),
        end_ratio=float(meta.get("end_ratio", DEFAULT_TRIM_END_RATIO)),
        trim_source=trim_source,
    )


def _segment_kind_for_clip(clip: ClipAsset) -> Literal["source", "neutral"]:
    return "neutral" if clip.source == "neutral" else "source"


def _transition_diagnostic_from_clip(clip: ClipAsset) -> dict[str, object]:
    diagnostics = dict((clip.meta or {}).get("transition_diagnostics") or {})
    attempts = diagnostics.get("attempts") or []
    quality = attempts[-1].get("quality") if attempts else None
    return {
        "label": clip.label,
        "strategy": diagnostics.get("final_strategy") or "unknown",
        "retry_count": int(diagnostics.get("retry_count") or 0),
        "fallback_count": int(diagnostics.get("fallback_count") or 0),
        "quality_failures": int(diagnostics.get("quality_failures") or 0),
        "passed": bool(diagnostics.get("passed", True)),
        "quality": quality,
    }


def compose_json_clips(
    clips: list[ClipAsset],
    *,
    target_fps: int,
    transition_frames: int,
    transition_method: TransitionMethod = "smoothstep",
) -> tuple[dict[str, np.ndarray], list[SegmentTrace], ComposeStats]:
    if not clips:
        raise ValueError("clips must not be empty")
    if transition_frames <= 0:
        raise ValueError("transition_frames must be positive")

    trimmed_clips = [_trim_source_clip(clip) for clip in clips]
    neutral_template = first_neutral_face_template(clips)
    normalized_word_clips = [
        normalize_clip(clip, target_fps, neutral_template)
        for clip in trimmed_clips
    ]

    output_arrays: dict[str, np.ndarray] = {}
    segments: list[SegmentTrace] = []
    generated_transition_count = 0
    transition_retry_count = 0
    transition_fallback_count = 0
    transition_quality_failures = 0
    transition_diagnostics: list[dict[str, object]] = []

    cursor = 0
    first_clip = normalized_word_clips[0]
    output_arrays = _append_arrays(output_arrays, first_clip.arrays)
    _add_segment(
        segments,
        _segment_kind_for_clip(first_clip),
        first_clip.label,
        cursor,
        first_clip.frame_count,
        False,
    )
    cursor += first_clip.frame_count

    for index in range(len(normalized_word_clips) - 1):
        current_clip = normalized_word_clips[index]
        next_clip = normalized_word_clips[index + 1]
        transition_clip = generate_transition(
            current_clip,
            next_clip,
            method=transition_method,
            transition_frames=transition_frames,
            allow_fallback=True,
        )
        generated_transition_count += 1
        diagnostic = _transition_diagnostic_from_clip(transition_clip)
        transition_retry_count += int(diagnostic["retry_count"])
        transition_fallback_count += int(diagnostic["fallback_count"])
        transition_quality_failures += int(diagnostic["quality_failures"])
        transition_diagnostics.append(diagnostic)

        output_arrays = _append_arrays(output_arrays, transition_clip.arrays)
        _add_segment(
            segments,
            "generated-transition",
            transition_clip.label,
            cursor,
            transition_clip.frame_count,
            True,
        )
        cursor += transition_clip.frame_count

        output_arrays = _append_arrays(output_arrays, next_clip.arrays)
        _add_segment(
            segments,
            _segment_kind_for_clip(next_clip),
            next_clip.label,
            cursor,
            next_clip.frame_count,
            False,
        )
        cursor += next_clip.frame_count

    output_arrays = smooth_sequence(output_arrays, segments)
    stats = ComposeStats(
        source_clip_count=len(normalized_word_clips),
        generated_transition_count=generated_transition_count,
        output_frame_count=int(next(iter(output_arrays.values())).shape[0]),
        boundary_hold_frame_count=0,
        cache_hits=0,
        transition_retry_count=transition_retry_count,
        transition_fallback_count=transition_fallback_count,
        transition_quality_failures=transition_quality_failures,
        transition_diagnostics=transition_diagnostics,
    )
    return output_arrays, segments, stats
