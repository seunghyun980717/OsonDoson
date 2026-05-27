"""High-level composition flow for N word clips."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Literal

import numpy as np

from .clip_loader import load_word_clip
from .normalizer import (
    DEFAULT_TRIM_END_RATIO,
    DEFAULT_TRIM_START_RATIO,
    first_neutral_face_template,
    normalize_clip,
    resample_clip_frames,
    trim_clip,
)
from .schemas import ClipAsset, ComposeRequest, ComposeStats, SegmentTrace
from .smoother import smooth_sequence
from .transition_generator import evaluate_transition_quality, generate_transition
from .transition_selector import TransitionSelector


def _append_arrays(target: dict[str, np.ndarray], source: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    if not target:
        return {key: value.copy() for key, value in source.items()}
    return {key: np.concatenate([target[key], source[key]], axis=0) for key in target.keys()}


def _add_segment(
    segments: list[SegmentTrace],
    kind: str,
    label: str,
    start_frame: int,
    frame_count: int,
    is_transition: bool,
) -> None:
    segments.append(
        SegmentTrace(
            kind=kind,  # type: ignore[arg-type]
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


def _duration_match_clip(clip: ClipAsset, target_fps: int) -> ClipAsset:
    meta = clip.meta or {}
    requested = meta.get("target_frame_count")
    requested_fps = meta.get("target_fps")
    if requested is None:
        return clip
    if requested_fps is not None and int(requested_fps) != int(target_fps):
        return clip
    target_frames = max(1, int(requested))
    return resample_clip_frames(clip, target_frames)


def _make_boundary_hold(clip: ClipAsset, which: Literal["start", "end"], frame_count: int) -> ClipAsset:
    if frame_count <= 0:
        raise ValueError("frame_count must be positive")

    arrays: dict[str, np.ndarray] = {}
    for key, value in clip.arrays.items():
        frame = value[[0]].copy() if which == "start" else value[-1:].copy()
        arrays[key] = np.repeat(frame, frame_count, axis=0)

    return ClipAsset(
        id=f"{clip.id}__{which}_hold",
        label=f"{clip.label}-{which}-hold",
        fps=clip.fps,
        source="neutral",
        path=None,
        arrays=arrays,
        meta={"trim_source": "synthetic-boundary-hold", "boundary_hold": which},
    )


def _segment_kind_for_clip(clip: ClipAsset) -> str:
    return "neutral" if clip.source == "neutral" else "source"


def _transition_diagnostic_from_clip(clip: ClipAsset, strategy: str | None = None) -> dict[str, object]:
    diagnostics = dict((clip.meta or {}).get("transition_diagnostics") or {})
    quality = diagnostics.get("attempts", [{}])[-1].get("quality") if diagnostics.get("attempts") else None
    return {
        "label": clip.label,
        "strategy": strategy or diagnostics.get("final_strategy") or "unknown",
        "retry_count": int(diagnostics.get("retry_count") or 0),
        "fallback_count": int(diagnostics.get("fallback_count") or 0),
        "quality_failures": int(diagnostics.get("quality_failures") or 0),
        "passed": bool(diagnostics.get("passed", True)),
        "quality": quality,
    }


def compose_sequence(
    request: ComposeRequest,
    asset_root: Path,
    selector: TransitionSelector,
    clip_loader: Callable[[Path, str], ClipAsset] = load_word_clip,
) -> tuple[dict[str, np.ndarray], list[SegmentTrace], ComposeStats]:
    if not request.word_ids:
        raise ValueError("ComposeRequest.word_ids must not be empty")

    raw_clips = [clip_loader(asset_root, word_id) for word_id in request.word_ids]
    trimmed_clips = [_trim_source_clip(clip) for clip in raw_clips]
    neutral_template = first_neutral_face_template(raw_clips)
    normalized_word_clips = [
        _duration_match_clip(normalize_clip(clip, request.target_fps, neutral_template), request.target_fps)
        for clip in trimmed_clips
    ]
    if request.boundary_policy != "direct-hold":
        raise ValueError(f"Unsupported boundary policy: {request.boundary_policy}")

    output_arrays: dict[str, np.ndarray] = {}
    segments: list[SegmentTrace] = []
    generated_transition_count = 0
    cache_hits = 0
    boundary_hold_frame_count = 0
    transition_retry_count = 0
    transition_fallback_count = 0
    transition_quality_failures = 0
    transition_diagnostics: list[dict[str, object]] = []

    cursor = 0
    if request.start_hold_frames > 0:
        start_hold = _make_boundary_hold(normalized_word_clips[0], "start", int(request.start_hold_frames))
        output_arrays = _append_arrays(output_arrays, start_hold.arrays)
        _add_segment(
            segments,
            "boundary-hold",
            start_hold.label,
            cursor,
            start_hold.frame_count,
            False,
        )
        cursor += start_hold.frame_count
        boundary_hold_frame_count += start_hold.frame_count

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

        transition_clip = None
        transition_kind = "generated-transition"

        if request.transition_policy == "cached-first":
            transition_clip, source = selector.get(
                asset_root,
                current_clip.label,
                next_clip.label,
                request.target_fps,
                request.transition_method,
                request.transition_frames,
            )
            if transition_clip is not None:
                if source == "disk":
                    transition_clip = normalize_clip(transition_clip, request.target_fps, neutral_template)
                cached_quality = evaluate_transition_quality(current_clip, next_clip, transition_clip)
                if cached_quality["passed"]:
                    transition_kind = "cached-transition"
                    if source in {"disk", "memory"}:
                        cache_hits += 1
                    transition_diagnostics.append(
                        {
                            "label": transition_clip.label,
                            "strategy": "cached-transition",
                            "retry_count": 0,
                            "fallback_count": 0,
                            "quality_failures": 0,
                            "passed": True,
                            "quality": cached_quality,
                        }
                    )
                else:
                    transition_quality_failures += 1
                    transition_diagnostics.append(
                        {
                            "label": transition_clip.label,
                            "strategy": "cached-rejected",
                            "retry_count": 0,
                            "fallback_count": 0,
                            "quality_failures": 1,
                            "passed": False,
                            "quality": cached_quality,
                        }
                    )
                    transition_clip = None

        if transition_clip is None:
            transition_clip = generate_transition(
                current_clip,
                next_clip,
                method=request.transition_method,
                transition_frames=request.transition_frames,
                allow_fallback=request.transition_frames is None,
            )
            selector.put_generated(
                current_clip.label,
                next_clip.label,
                request.target_fps,
                transition_clip,
                request.transition_method,
                request.transition_frames,
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
            transition_kind,
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

    if request.end_hold_frames > 0:
        end_hold = _make_boundary_hold(normalized_word_clips[-1], "end", int(request.end_hold_frames))
        output_arrays = _append_arrays(output_arrays, end_hold.arrays)
        _add_segment(
            segments,
            "boundary-hold",
            end_hold.label,
            cursor,
            end_hold.frame_count,
            False,
        )
        cursor += end_hold.frame_count
        boundary_hold_frame_count += end_hold.frame_count

    output_arrays = smooth_sequence(output_arrays, segments)
    stats = ComposeStats(
        source_clip_count=len(normalized_word_clips),
        generated_transition_count=generated_transition_count,
        output_frame_count=int(next(iter(output_arrays.values())).shape[0]),
        boundary_hold_frame_count=boundary_hold_frame_count,
        cache_hits=cache_hits,
        transition_retry_count=transition_retry_count,
        transition_fallback_count=transition_fallback_count,
        transition_quality_failures=transition_quality_failures,
        transition_diagnostics=transition_diagnostics,
    )
    return output_arrays, segments, stats
