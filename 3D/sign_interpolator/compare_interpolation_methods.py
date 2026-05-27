"""Generate sentence JSONs for comparing transition interpolation methods."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sign_interpolator.composer import compose_sequence
    from sign_interpolator.schemas import ClipAsset, ComposeRequest, FrameData, VERSION
    from sign_interpolator.transition_selector import TransitionSelector
else:
    from .composer import compose_sequence
    from .schemas import ClipAsset, ComposeRequest, FrameData, VERSION
    from .transition_selector import TransitionSelector


METHODS = ("linear", "smoothstep", "hermite", "catmull_rom", "bezier")
DEFAULT_WORDS = ("1", "시간_10분", "해결")
DEFAULT_AIHUB_WORDS = (
    "NIA_SL_WORD0001_REAL01_F",
    "NIA_SL_WORD0002_REAL01_F",
    "NIA_SL_WORD0003_REAL01_F",
)
THREE_D_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORD_ROOT = THREE_D_ROOT / "data" / "words"
DEFAULT_AIHUB_ROOT = THREE_D_ROOT.parents[1] / "수어 영상" / "1.Training"
DEFAULT_OUTPUT_ROOT = THREE_D_ROOT / "sen" / "interpolation-tests"


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def _values(block: dict[str, Any], part_name: str) -> np.ndarray:
    values = block.get(part_name, {}).get("values")
    if not isinstance(values, list):
        raise ValueError(f"Missing keypoint values for part: {part_name}")
    return np.asarray(values, dtype=np.float32)


def _reshape_people_values(people: dict[str, Any], field_name: str, channels: int) -> np.ndarray:
    raw_values = people.get(field_name)
    if not isinstance(raw_values, list):
        raise ValueError(f"Missing AIHub people field: {field_name}")
    values = np.asarray(raw_values, dtype=np.float32)
    if values.size % channels != 0:
        raise ValueError(f"Unexpected {field_name} length: {values.size}")
    return values.reshape(values.size // channels, channels)


def _viewer_frames_array(frames: list[Any], field_name: str, channels: int, path: Path) -> np.ndarray:
    values_by_frame = []
    for index, frame in enumerate(frames):
        people = frame.get("people") if isinstance(frame, dict) else None
        if not isinstance(people, dict):
            raise ValueError(f"Frame {index} has no people object: {path}")
        values_by_frame.append(_reshape_people_values(people, field_name, channels))
    return np.stack(values_by_frame, axis=0).astype(np.float32)


def _find_aihub_sequence_dir(aihub_root: Path, sequence_id: str) -> Path:
    for dataset_dir in sorted(aihub_root.iterdir()):
        if (
            not dataset_dir.is_dir()
            or not dataset_dir.name.startswith("[라벨]")
            or not dataset_dir.name.endswith("_real_word_keypoint")
        ):
            continue
        for split_dir in sorted(dataset_dir.iterdir()):
            if not split_dir.is_dir():
                continue
            candidate = split_dir / sequence_id
            if candidate.is_dir():
                return candidate
    raise FileNotFoundError(f"AIHub sequence not found under {aihub_root}: {sequence_id}")


def _aihub_morpheme_path(aihub_root: Path, sequence_dir: Path, sequence_id: str) -> Path:
    keypoint_root = sequence_dir.parent.parent
    split_name = sequence_dir.parent.name
    morpheme_dir_name = keypoint_root.name.replace("_real_word_keypoint", "_real_word_morpheme")
    return aihub_root / morpheme_dir_name / "morpheme" / split_name / f"{sequence_id}_morpheme.json"


def _load_aihub_trim_meta(
    aihub_root: Path,
    sequence_dir: Path,
    sequence_id: str,
    frame_count: int,
    fps: int,
) -> dict[str, Any]:
    morpheme_path = _aihub_morpheme_path(aihub_root, sequence_dir, sequence_id)
    if not morpheme_path.exists():
        return {
            "trim_source": "full-sequence-morpheme-missing",
            "trim_start_frame": 0,
            "trim_end_frame": max(0, frame_count - 1),
            "morpheme_path": str(morpheme_path),
        }

    payload = _load_json(morpheme_path)
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return {
            "trim_source": "full-sequence-empty-morpheme",
            "trim_start_frame": 0,
            "trim_end_frame": max(0, frame_count - 1),
            "morpheme_path": str(morpheme_path),
        }

    starts = [float(item["start"]) for item in data if isinstance(item, dict) and item.get("start") is not None]
    ends = [float(item["end"]) for item in data if isinstance(item, dict) and item.get("end") is not None]
    if not starts or not ends:
        return {
            "trim_source": "full-sequence-invalid-morpheme",
            "trim_start_frame": 0,
            "trim_end_frame": max(0, frame_count - 1),
            "morpheme_path": str(morpheme_path),
        }

    start_sec = min(starts)
    end_sec = max(ends)
    start_frame = int(math.floor(start_sec * fps))
    end_frame = int(math.ceil(end_sec * fps)) - 1
    start_frame = max(0, min(start_frame, frame_count - 1))
    end_frame = max(start_frame, min(end_frame, frame_count - 1))
    labels = [
        str(attr.get("name"))
        for item in data
        if isinstance(item, dict)
        for attr in item.get("attributes", [])
        if isinstance(attr, dict) and attr.get("name")
    ]
    return {
        "trim_source": "aihub-morpheme",
        "trim_start_frame": start_frame,
        "trim_end_frame": end_frame,
        "morpheme_path": str(morpheme_path),
        "morpheme_start_sec": start_sec,
        "morpheme_end_sec": end_sec,
        "morpheme_labels": labels,
    }


def _load_aihub_frame(path: Path) -> dict[str, np.ndarray]:
    payload = _load_json(path)
    people = payload.get("people")
    if not isinstance(people, dict):
        raise ValueError(f"AIHub frame has no people object: {path}")
    return {
        "pose_2d": _reshape_people_values(people, "pose_keypoints_2d", 3),
        "pose_3d": _reshape_people_values(people, "pose_keypoints_3d", 4),
        "left_hand_2d": _reshape_people_values(people, "hand_left_keypoints_2d", 3),
        "left_hand_3d": _reshape_people_values(people, "hand_left_keypoints_3d", 4),
        "right_hand_2d": _reshape_people_values(people, "hand_right_keypoints_2d", 3),
        "right_hand_3d": _reshape_people_values(people, "hand_right_keypoints_3d", 4),
        "face_2d": _reshape_people_values(people, "face_keypoints_2d", 3),
        "face_3d": _reshape_people_values(people, "face_keypoints_3d", 4),
    }


def load_aihub_keypoint_clip(aihub_root: Path, sequence_id: str) -> ClipAsset:
    sequence_dir = _find_aihub_sequence_dir(aihub_root, sequence_id)
    frame_paths = sorted(sequence_dir.glob("*_keypoints.json"))
    if not frame_paths:
        raise FileNotFoundError(f"No AIHub keypoint frames found: {sequence_dir}")

    frame_arrays = [_load_aihub_frame(path) for path in frame_paths]
    arrays = {
        key: np.stack([frame[key] for frame in frame_arrays], axis=0).astype(np.float32)
        for key in frame_arrays[0].keys()
    }
    trim_meta = _load_aihub_trim_meta(aihub_root, sequence_dir, sequence_id, len(frame_paths), fps=30)
    return ClipAsset(
        id=sequence_id,
        label=sequence_id,
        fps=30,
        source="word",
        path=sequence_dir,
        arrays=arrays,
        meta={
            "source": "aihub-keypoint-dir",
            "raw_frame_count": len(frame_paths),
            **trim_meta,
        },
    )


def _build_3d_frame_block(
    image_2d: np.ndarray,
    depth_hint: np.ndarray | None,
    explicit_3d: np.ndarray | None,
    image_space: dict[str, Any],
) -> np.ndarray:
    if explicit_3d is not None:
        return explicit_3d.astype(np.float32, copy=True)

    width = float(image_space.get("width") or 1920)
    height = float(image_space.get("height") or 1080)
    coordinate_scale = max(1.0, height)
    output = np.zeros((*image_2d.shape[:2], 4), dtype=np.float32)
    output[:, :, 0] = (image_2d[:, :, 0] - (width * 0.5)) / coordinate_scale
    output[:, :, 1] = (image_2d[:, :, 1] - (height * 0.5)) / coordinate_scale
    if depth_hint is not None:
        output[:, :, 2] = -depth_hint[:, :, 0]
        output[:, :, 3] = np.minimum(image_2d[:, :, 2], depth_hint[:, :, 1])
    else:
        output[:, :, 3] = image_2d[:, :, 2]
    return output


def _pick_3d_block(keypoints: dict[str, Any]) -> dict[str, Any] | None:
    for block_name in ("estimated_3d", "calibrated_3d"):
        block = keypoints.get(block_name)
        if isinstance(block, dict):
            return block
    return None


def load_word_json_clip(word_root: Path, word_id: str) -> ClipAsset:
    path = word_root / f"{word_id}.json"
    payload = _load_json(path)

    if payload.get("schema_version") == "sign-keypoint-clip/v1" and isinstance(payload.get("frames"), list):
        frames = payload["frames"]
        if not frames:
            raise ValueError(f"Word JSON has no frames: {path}")
        arrays = {
            "pose_2d": _viewer_frames_array(frames, "pose_keypoints_2d", 3, path),
            "pose_3d": _viewer_frames_array(frames, "pose_keypoints_3d", 4, path),
            "left_hand_2d": _viewer_frames_array(frames, "hand_left_keypoints_2d", 3, path),
            "left_hand_3d": _viewer_frames_array(frames, "hand_left_keypoints_3d", 4, path),
            "right_hand_2d": _viewer_frames_array(frames, "hand_right_keypoints_2d", 3, path),
            "right_hand_3d": _viewer_frames_array(frames, "hand_right_keypoints_3d", 4, path),
            "face_2d": _viewer_frames_array(frames, "face_keypoints_2d", 3, path),
            "face_3d": _viewer_frames_array(frames, "face_keypoints_3d", 4, path),
        }
        return ClipAsset(
            id=str(payload.get("sample_id") or payload.get("gloss") or word_id),
            label=str(payload.get("gloss") or word_id),
            fps=int(payload.get("fps") or 30),
            source="word",
            path=path,
            arrays=arrays,
            meta={
                "source": "sign-keypoint-clip",
                "trim_start_frame": 0,
                "trim_end_frame": max(0, len(frames) - 1),
                "source_start_frame": int((payload.get("segment") or {}).get("source_start_frame") or 0),
                "source_end_frame_exclusive": int(
                    (payload.get("segment") or {}).get("source_end_frame_exclusive") or len(frames)
                ),
                "trim_source": (payload.get("processing") or {}).get("trim_policy"),
            },
        )

    sample = payload.get("sample")
    if not isinstance(sample, dict):
        raise ValueError(f"Word JSON has no sample: {path}")

    keypoints = sample.get("keypoints") or {}
    image_2d = keypoints.get("image_2d")
    if not isinstance(image_2d, dict):
        raise ValueError(f"Word JSON has no image_2d keypoints: {path}")

    depth_hint = keypoints.get("depth_hint") if isinstance(keypoints.get("depth_hint"), dict) else None
    explicit_3d = _pick_3d_block(keypoints)
    image_space = (sample.get("spaces") or {}).get("image_2d") or {}

    pose_2d = _values(image_2d, "pose")
    left_2d = _values(image_2d, "left_hand")
    right_2d = _values(image_2d, "right_hand")
    face_2d = _values(image_2d, "face")

    arrays = {
        "pose_2d": pose_2d,
        "left_hand_2d": left_2d,
        "right_hand_2d": right_2d,
        "face_2d": face_2d,
        "pose_3d": _build_3d_frame_block(
            pose_2d,
            _values(depth_hint, "pose") if depth_hint else None,
            _values(explicit_3d, "pose") if explicit_3d else None,
            image_space,
        ),
        "left_hand_3d": _build_3d_frame_block(
            left_2d,
            _values(depth_hint, "left_hand") if depth_hint else None,
            _values(explicit_3d, "left_hand") if explicit_3d else None,
            image_space,
        ),
        "right_hand_3d": _build_3d_frame_block(
            right_2d,
            _values(depth_hint, "right_hand") if depth_hint else None,
            _values(explicit_3d, "right_hand") if explicit_3d else None,
            image_space,
        ),
        "face_3d": _build_3d_frame_block(
            face_2d,
            _values(depth_hint, "face") if depth_hint else None,
            _values(explicit_3d, "face") if explicit_3d else None,
            image_space,
        ),
    }
    frame_count = int(sample.get("segment", {}).get("frame_count") or pose_2d.shape[0])
    return ClipAsset(
        id=str(sample.get("sample_id") or payload.get("word") or word_id),
        label=str(payload.get("word") or word_id),
        fps=int(sample.get("segment", {}).get("fps") or 30),
        source="word",
        path=path,
        arrays=arrays,
        meta={
            "source": "word-json",
            "trim_start_frame": 0,
            "trim_end_frame": max(0, frame_count - 1),
        },
    )


def _flatten(array: np.ndarray) -> list[float]:
    return array.reshape(-1).astype(np.float32).tolist()


def _frame_list_from_arrays(arrays: dict[str, np.ndarray]) -> list[FrameData]:
    frame_count = next(iter(arrays.values())).shape[0]
    return [
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
        for index in range(frame_count)
    ]


def _dump_model(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return value


def _summarize_method(method: str, frames: list[FrameData], segments: list[Any], stats: Any) -> dict[str, Any]:
    segment_dicts = [_dump_model(segment) for segment in segments]
    stats_dict = _dump_model(stats)
    transition_segments = [segment for segment in segment_dicts if segment.get("is_transition")]
    transition_frame_counts = [
        int(segment["end_frame"]) - int(segment["start_frame"]) + 1
        for segment in transition_segments
    ]
    qualities = [
        diagnostic.get("quality")
        for diagnostic in (stats_dict.get("transition_diagnostics") or [])
        if isinstance(diagnostic.get("quality"), dict)
    ]
    failed_qualities = [quality for quality in qualities if not quality.get("passed")]
    max_speed_ratio = max((float(quality.get("max_speed_ratio") or 0.0) for quality in qualities), default=0.0)
    terminal_discontinuity = max(
        (float(quality.get("terminal_discontinuity") or 0.0) for quality in qualities),
        default=0.0,
    )
    max_overshoot = max((float(quality.get("max_overshoot") or 0.0) for quality in qualities), default=0.0)
    bilateral_spread_increase = max(
        (float(quality.get("bilateral_spread_increase") or 0.0) for quality in qualities),
        default=0.0,
    )

    return {
        "method": method,
        "frame_count": len(frames),
        "transition_segment_count": len(transition_segments),
        "transition_frame_count_avg": (
            sum(transition_frame_counts) / len(transition_frame_counts)
            if transition_frame_counts
            else 0.0
        ),
        "transition_frame_count_max": max(transition_frame_counts, default=0),
        "max_speed_ratio": max_speed_ratio,
        "terminal_discontinuity": terminal_discontinuity,
        "has_overshoot": max_overshoot > 0.0,
        "max_overshoot": max_overshoot,
        "bilateral_spread_increase": bilateral_spread_increase,
        "transition_quality": qualities,
        "warnings": [
            "transition_quality_failed"
            for _quality in failed_qualities
        ],
    }


def run_comparison(args: argparse.Namespace) -> dict[str, Any]:
    test_dir = Path(args.output_root) / args.test_name
    asset_root = Path(args.word_root)
    clip_loader = load_word_json_clip
    if args.input_source == "aihub":
        asset_root = Path(args.aihub_root)
        clip_loader = load_aihub_keypoint_clip
    source_clips = [clip_loader(asset_root, word_id) for word_id in args.words]

    report: dict[str, Any] = {
        "test_name": args.test_name,
        "input_source": args.input_source,
        "asset_root": str(asset_root),
        "word_ids": args.words,
        "source_clips": [
            {
                "id": clip.id,
                "label": clip.label,
                "path": str(clip.path) if clip.path else None,
                "raw_frame_count": int((clip.meta or {}).get("raw_frame_count") or clip.frame_count),
                "trim_start_frame": (clip.meta or {}).get("trim_start_frame"),
                "trim_end_frame": (clip.meta or {}).get("trim_end_frame"),
                "trim_source": (clip.meta or {}).get("trim_source"),
                "morpheme_start_sec": (clip.meta or {}).get("morpheme_start_sec"),
                "morpheme_end_sec": (clip.meta or {}).get("morpheme_end_sec"),
                "morpheme_path": (clip.meta or {}).get("morpheme_path"),
                "morpheme_labels": (clip.meta or {}).get("morpheme_labels"),
            }
            for clip in source_clips
        ],
        "target_fps": args.target_fps,
        "transition_frames": args.transition_frames,
        "methods": {},
        "failed_or_warning_methods": [],
    }

    for method in METHODS:
        request = ComposeRequest(
            word_ids=list(args.words),
            target_fps=args.target_fps,
            transition_policy="generated-only",
            transition_method=method,
            transition_frames=args.transition_frames,
            start_hold_frames=args.start_hold_frames,
            end_hold_frames=args.end_hold_frames,
        )
        started = time.perf_counter()
        arrays, segments, stats = compose_sequence(
            request,
            asset_root,
            TransitionSelector(max_entries=0),
            clip_loader=clip_loader,
        )
        frames = _frame_list_from_arrays(arrays)
        sentence_path = test_dir / f"{method}.json"
        sentence_payload = {
            "version": VERSION,
            "fps": args.target_fps,
            "frame_count": len(frames),
            "input_source": args.input_source,
            "asset_root": str(asset_root),
            "word_ids": list(args.words),
            "transition_method": method,
            "transition_frames": args.transition_frames,
            "frames": frames,
            "segments": [_dump_model(segment) for segment in segments],
            "stats": _dump_model(stats),
        }
        _write_json(sentence_path, sentence_payload)
        elapsed = time.perf_counter() - started
        summary = _summarize_method(method, frames, segments, stats)
        summary["generation_seconds"] = round(elapsed, 4)
        summary["output_file"] = str(sentence_path)
        summary["viewer_url"] = f"/sentence.html?src=/sen/interpolation-tests/{args.test_name}/{method}.json"
        report["methods"][method] = summary
        if summary["warnings"]:
            report["failed_or_warning_methods"].append(method)

    _write_json(test_dir / "report.json", report)
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-name", default="default")
    parser.add_argument("--words", nargs="+", default=None)
    parser.add_argument("--input-source", choices=("word-json", "aihub"), default="word-json")
    parser.add_argument("--word-root", default=str(DEFAULT_WORD_ROOT))
    parser.add_argument("--aihub-root", default=str(DEFAULT_AIHUB_ROOT))
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--transition-frames", type=int, default=12)
    parser.add_argument("--target-fps", type=int, choices=[20, 24, 30], default=30)
    parser.add_argument("--start-hold-frames", type=int, default=3)
    parser.add_argument("--end-hold-frames", type=int, default=4)
    args = parser.parse_args(argv)
    if args.words is None:
        args.words = list(DEFAULT_AIHUB_WORDS if args.input_source == "aihub" else DEFAULT_WORDS)
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    report = run_comparison(args)
    output_dir = Path(args.output_root) / args.test_name
    print(f"Wrote interpolation comparison to {output_dir}")
    print(f"Warning methods: {', '.join(report['failed_or_warning_methods']) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
