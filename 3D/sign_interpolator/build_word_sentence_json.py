"""Build a sentence JSON by concatenating word JSON clips.

This is intentionally simpler than the interpolation comparison runner. It keeps
source frame order intact so frame-level correction metadata can be inspected in
the sentence viewer.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


THREE_D_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORD_ROOT = THREE_D_ROOT / "data" / "words"
DEFAULT_OUTPUT = THREE_D_ROOT / "sen" / "sentence.json"
DEFAULT_WORDS = ("0", "LG전자(전기)", "감사", "돈가스", "감사합니다", "보관", "제세공과금")
KEYPOINT_PARTS = (
    ("pose", "pose_keypoints_2d", "pose_keypoints_3d", 25),
    ("left_hand", "hand_left_keypoints_2d", "hand_left_keypoints_3d", 21),
    ("right_hand", "hand_right_keypoints_2d", "hand_right_keypoints_3d", 21),
    ("face", "face_keypoints_2d", "face_keypoints_3d", None),
)
THREE_D_PRIORITY = ("postprocessed_3d", "estimated_3d", "calibrated_3d")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def values(block: dict[str, Any] | None, part_name: str) -> np.ndarray | None:
    if not isinstance(block, dict):
        return None
    part = block.get(part_name)
    if not isinstance(part, dict):
        return None
    part_values = part.get("values")
    if not isinstance(part_values, list):
        return None
    return np.asarray(part_values, dtype=np.float32)


def pick_3d_block(keypoints: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    for block_name in THREE_D_PRIORITY:
        block = keypoints.get(block_name)
        if isinstance(block, dict):
            return block_name, block
    return None, None


def build_3d_from_2d(
    image_2d: np.ndarray,
    depth_hint: np.ndarray | None,
    image_space: dict[str, Any],
) -> np.ndarray:
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


def ensure_part(array: np.ndarray | None, frame_count: int, point_count: int | None, dims: int) -> np.ndarray:
    if array is None:
        if point_count is None:
            point_count = 0
        return np.zeros((frame_count, point_count, dims), dtype=np.float32)
    if array.ndim != 3:
        raise ValueError(f"Expected 3D array, got shape={array.shape}")
    if (point_count is not None and array.shape[1] != point_count) or array.shape[2] != dims:
        raise ValueError(f"Unexpected part shape={array.shape}, expected (*,{point_count},{dims})")
    return array.astype(np.float32, copy=False)


def flatten_frame(array: np.ndarray, index: int) -> list[float]:
    return array[index].reshape(-1).astype(np.float32).tolist()


def corrected_word_name(prefix: str, index: int, word: str) -> str:
    return f"{prefix}_{index:02d}_{word}"


def select_payload(
    word_root: Path,
    word: str,
    index: int,
    corrected_prefix: str,
    source_mode: str,
) -> tuple[Path, dict[str, Any], Path, dict[str, Any], str]:
    source_path = word_root / f"{word}.json"
    source_payload = load_json(source_path)
    if source_mode == "source":
        return source_path, source_payload, source_path, source_payload, "source"

    corrected_path = word_root / f"{corrected_word_name(corrected_prefix, index, word)}.json"
    if corrected_path.exists():
        return source_path, source_payload, corrected_path, load_json(corrected_path), "corrected"

    if source_mode == "corrected":
        raise FileNotFoundError(f"Corrected word JSON not found: {corrected_path}")

    return source_path, source_payload, source_path, source_payload, "source"


def image_2d_block(payload: dict[str, Any]) -> dict[str, Any]:
    sample = payload.get("sample")
    if not isinstance(sample, dict):
        raise ValueError("Word JSON has no sample object")
    keypoints = sample.get("keypoints")
    if not isinstance(keypoints, dict):
        raise ValueError("Word JSON has no sample.keypoints object")
    image_2d = keypoints.get("image_2d")
    if not isinstance(image_2d, dict):
        raise ValueError("Word JSON has no sample.keypoints.image_2d object")
    return image_2d


def make_arrays(payload: dict[str, Any]) -> tuple[dict[str, np.ndarray], str]:
    sample = payload.get("sample") or {}
    keypoints = sample.get("keypoints") or {}
    image_2d = image_2d_block(payload)
    depth_hint = keypoints.get("depth_hint") if isinstance(keypoints.get("depth_hint"), dict) else None
    explicit_name, explicit_3d = pick_3d_block(keypoints)
    image_space = (sample.get("spaces") or {}).get("image_2d") or {}

    pose_2d = values(image_2d, "pose")
    if pose_2d is None:
        raise ValueError("Missing pose image_2d")
    frame_count = int(pose_2d.shape[0])

    arrays: dict[str, np.ndarray] = {}
    for part_name, _field_2d, _field_3d, point_count in KEYPOINT_PARTS:
        part_2d = ensure_part(values(image_2d, part_name), frame_count, point_count, 3)
        arrays[f"{part_name}_2d"] = part_2d
        explicit_part_3d = values(explicit_3d, part_name) if explicit_3d else None
        if explicit_part_3d is not None:
            arrays[f"{part_name}_3d"] = ensure_part(explicit_part_3d, frame_count, point_count, 4)
        else:
            arrays[f"{part_name}_3d"] = build_3d_from_2d(
                part_2d,
                values(depth_hint, part_name) if depth_hint else None,
                image_space,
            )

    return arrays, explicit_name or "depth_hint_fallback"


def build_correction_frames(
    source_payload: dict[str, Any],
    output_payload: dict[str, Any],
    threshold_px: float,
) -> list[list[dict[str, Any]]]:
    source_image = image_2d_block(source_payload)
    output_image = image_2d_block(output_payload)
    source_pose = values(source_image, "pose")
    if source_pose is None:
        return []
    frame_count = int(source_pose.shape[0])
    correction_frames: list[list[dict[str, Any]]] = [[] for _ in range(frame_count)]

    for part_name, _field_2d, _field_3d, point_count in KEYPOINT_PARTS:
        source = ensure_part(values(source_image, part_name), frame_count, point_count, 3)
        output = ensure_part(values(output_image, part_name), frame_count, point_count, 3)
        if point_count is None:
            point_count = min(source.shape[1], output.shape[1])
        common_frames = min(source.shape[0], output.shape[0], frame_count)
        for frame_index in range(common_frames):
            for joint_index in range(point_count):
                before = source[frame_index, joint_index]
                after = output[frame_index, joint_index]
                if not np.all(np.isfinite(before[:2])) or not np.all(np.isfinite(after[:2])):
                    continue
                delta = float(np.linalg.norm(after[:2] - before[:2]))
                if delta <= threshold_px:
                    continue
                correction_frames[frame_index].append(
                    {
                        "part": part_name,
                        "joint": joint_index,
                        "from": [round(float(before[0]), 4), round(float(before[1]), 4), round(float(before[2]), 4)],
                        "to": [round(float(after[0]), 4), round(float(after[1]), 4), round(float(after[2]), 4)],
                        "delta_px": round(delta, 4),
                    }
                )
    return correction_frames


def make_frame(
    arrays: dict[str, np.ndarray],
    frame_index: int,
    source_word: str,
    source_frame_index: int,
    correction_items: list[dict[str, Any]],
    correction_method: str | None,
) -> dict[str, Any]:
    frame: dict[str, Any] = {
        "version": 1.3,
        "camparam": {},
        "source_word": source_word,
        "source_frame_index": source_frame_index,
        "people": {
            "person_id": -1,
            "pose_keypoints_2d": flatten_frame(arrays["pose_2d"], frame_index),
            "pose_keypoints_3d": flatten_frame(arrays["pose_3d"], frame_index),
            "hand_left_keypoints_2d": flatten_frame(arrays["left_hand_2d"], frame_index),
            "hand_left_keypoints_3d": flatten_frame(arrays["left_hand_3d"], frame_index),
            "hand_right_keypoints_2d": flatten_frame(arrays["right_hand_2d"], frame_index),
            "hand_right_keypoints_3d": flatten_frame(arrays["right_hand_3d"], frame_index),
            "face_keypoints_2d": flatten_frame(arrays["face_2d"], frame_index),
            "face_keypoints_3d": flatten_frame(arrays["face_3d"], frame_index),
        },
    }
    if correction_items:
        frame["keypoint_corrections"] = {
            "method": correction_method or "coordinate-diff",
            "count": len(correction_items),
            "items": correction_items,
        }
    return frame


def source_processing_method(payload: dict[str, Any]) -> str | None:
    sample = payload.get("sample")
    if not isinstance(sample, dict):
        return None
    processing = sample.get("processing")
    if not isinstance(processing, dict):
        return None
    for key in (
        "image_2d_preprocess_method",
        "image_2d_smoothing_method",
        "image_2d_repair_method",
        "estimated_3d_method",
        "postprocessed_3d_method",
    ):
        value = processing.get(key)
        if value:
            return str(value)
    return None


def build_sentence(args: argparse.Namespace) -> dict[str, Any]:
    word_root = Path(args.word_root)
    frames: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    source_clips: list[dict[str, Any]] = []
    correction_count = 0
    depth_sources: dict[str, int] = {}

    for index, word in enumerate(args.words):
        source_path, source_payload, selected_path, selected_payload, source_mode = select_payload(
            word_root,
            word,
            index,
            args.corrected_prefix,
            args.source_mode,
        )
        arrays, depth_source = make_arrays(selected_payload)
        depth_sources[depth_source] = depth_sources.get(depth_source, 0) + 1
        correction_method = source_processing_method(selected_payload)
        correction_frames = (
            build_correction_frames(source_payload, selected_payload, args.correction_threshold_px)
            if selected_path != source_path
            else [[] for _ in range(arrays["pose_2d"].shape[0])]
        )
        frame_count = int(arrays["pose_2d"].shape[0])
        segment_start = len(frames)
        for frame_index in range(frame_count):
            items = correction_frames[frame_index] if frame_index < len(correction_frames) else []
            correction_count += len(items)
            frames.append(
                make_frame(
                    arrays,
                    frame_index,
                    word,
                    frame_index,
                    items,
                    correction_method,
                )
            )
        segments.append(
            {
                "kind": "source",
                "label": word,
                "start_frame": segment_start,
                "end_frame": len(frames) - 1,
                "is_transition": False,
                "source_path": str(source_path),
                "selected_path": str(selected_path),
                "source_mode": source_mode,
            }
        )
        source_clips.append(
            {
                "word": word,
                "source_path": str(source_path),
                "selected_path": str(selected_path),
                "source_mode": source_mode,
                "frame_count": frame_count,
                "correction_method": correction_method,
            }
        )

        if args.hold_frames > 0 and index < len(args.words) - 1:
            hold_frame = copy.deepcopy(frames[-1])
            hold_frame.pop("keypoint_corrections", None)
            hold_frame["source_word"] = f"{word}-hold"
            hold_start = len(frames)
            for _ in range(args.hold_frames):
                frames.append(copy.deepcopy(hold_frame))
            segments.append(
                {
                    "kind": "boundary-hold",
                    "label": f"{word}-hold",
                    "start_frame": hold_start,
                    "end_frame": len(frames) - 1,
                    "is_transition": True,
                }
            )

    return {
        "version": 1.3,
        "schema_version": "sentence-keypoints/from-word-json-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "fps": args.target_fps,
        "frame_count": len(frames),
        "word_ids": list(args.words),
        "source": {
            "type": "word-json-concat",
            "word_root": str(word_root),
            "source_mode": args.source_mode,
            "corrected_prefix": args.corrected_prefix,
            "correction_threshold_px": args.correction_threshold_px,
            "depth_sources": depth_sources,
            "clips": source_clips,
        },
        "keypoint_corrections_summary": {
            "total_corrected_points": correction_count,
            "frames_with_corrections": sum(1 for frame in frames if frame.get("keypoint_corrections")),
        },
        "segments": segments,
        "frames": frames,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", default=str(DEFAULT_WORD_ROOT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--also-output", default="")
    parser.add_argument("--words", nargs="+", default=list(DEFAULT_WORDS))
    parser.add_argument("--target-fps", type=int, default=30)
    parser.add_argument("--hold-frames", type=int, default=4)
    parser.add_argument("--corrected-prefix", default="smooth2d_v2_QA_full")
    parser.add_argument(
        "--source-mode",
        choices=("source", "corrected", "corrected-if-available"),
        default="corrected-if-available",
        help="Use raw word JSONs, require corrected QA copies, or use corrected copies when present.",
    )
    parser.add_argument("--correction-threshold-px", type=float, default=0.05)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.words:
        raise SystemExit("--words must not be empty")
    if args.hold_frames < 0:
        raise SystemExit("--hold-frames must be >= 0")
    if not math.isfinite(args.correction_threshold_px) or args.correction_threshold_px < 0:
        raise SystemExit("--correction-threshold-px must be a finite non-negative number")

    payload = build_sentence(args)
    output = Path(args.output)
    write_json(output, payload)
    if args.also_output:
        write_json(Path(args.also_output), payload)
    print(f"Wrote {output}")
    print(f"frames={payload['frame_count']} corrections={payload['keypoint_corrections_summary']['total_corrected_points']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
