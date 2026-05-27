#!/usr/bin/env python3
"""Convert raw_out merged word keypoints to the word_dic JSON schema."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from build_mlp_word_viewer_qa import (  # noqa: E402
    HAND_JOINT_COUNT,
    HAND_ORDER,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_WRIST,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_WRIST,
    build_model_input,
    distance_3d,
    load_model,
)

DEFAULT_INPUT_ROOT = Path("/Users/suwon/SSAFY/2학기/자율/raw_out/word_keypoints_merged")
DEFAULT_OUTPUT_ROOT = Path("/Users/suwon/SSAFY/2학기/자율/시연_단어")
DEFAULT_WORD_DIC_ROOT = Path("/Users/suwon/SSAFY/2학기/자율/word_dic")
DEFAULT_UNPROCESSED_REPORT = DEFAULT_INPUT_ROOT / "_unprocessed_neither.json"
DEFAULT_CHECKPOINT = THREE_D_ROOT / "hand_lifting" / "runs" / "v0_mlp" / "hand_lifting_v0_mlp_best.pt"

SCHEMA_VERSION = "sign-keypoint-clip/v1"
DEFAULT_FPS = 30.0
IMAGE_WIDTH = 1920.0
IMAGE_HEIGHT = 1080.0
FACE_POINT_COUNT = 68
POSE_RIGHT_SHOULDER_INDEX = 2
POSE_LEFT_SHOULDER_INDEX = 5
Z_POLARITY = 1.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--word-dic-root", type=Path, default=DEFAULT_WORD_DIC_ROOT)
    parser.add_argument("--unprocessed-report", type=Path, default=DEFAULT_UNPROCESSED_REPORT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--indent", type=int, default=2)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


def normalized_text(value: Any) -> str:
    return unicodedata.normalize("NFC", str(value if value is not None else "").strip())


def sanitize_file_name(value: str) -> str:
    forbidden = '<>:"/\\|?*'
    cleaned = "".join("_" if char in forbidden or ord(char) < 32 else char for char in normalized_text(value))
    return cleaned or "unknown"


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def flat_to_points(values: Any, stride: int) -> list[list[float]]:
    if not isinstance(values, list):
        return []
    return [
        [finite_float(values[index + offset]) for offset in range(stride)]
        for index in range(0, len(values) - stride + 1, stride)
    ]


def flatten(points: list[list[float]]) -> list[float]:
    return [round(finite_float(value), 6) for point in points for value in point]


def ensure_points(points: list[list[float]], count: int, dims: int) -> list[list[float]]:
    output: list[list[float]] = []
    for index in range(count):
        point = points[index] if index < len(points) else []
        output.append([finite_float(point[axis] if axis < len(point) else 0.0) for axis in range(dims)])
    return output


def shoulder_normalization(pose_3d: list[list[float]]) -> tuple[list[float], float]:
    right = pose_3d[POSE_RIGHT_SHOULDER_INDEX] if len(pose_3d) > POSE_RIGHT_SHOULDER_INDEX else [0, 0, 0, 0]
    left = pose_3d[POSE_LEFT_SHOULDER_INDEX] if len(pose_3d) > POSE_LEFT_SHOULDER_INDEX else [0, 0, 0, 0]
    center = [(right[axis] + left[axis]) * 0.5 for axis in range(3)]
    width = math.sqrt(sum((left[axis] - right[axis]) ** 2 for axis in range(3)))
    return center, max(width, 1e-6)


def normalize_3d_points(points: list[list[float]], center: list[float], width: float) -> list[list[float]]:
    return [
        [
            (point[0] - center[0]) / width,
            (point[1] - center[1]) / width,
            ((point[2] - center[2]) / width) * Z_POLARITY,
            point[3] if len(point) > 3 else 0.0,
        ]
        for point in points
    ]


def depth_for_part(part_name: str, index: int) -> float:
    if part_name == "pose":
        if index in (0, 15, 16, 17, 18):
            return 0.12
        if index in (3, 6):
            return 0.22
        if index in (4, 7):
            return 0.30
        return 0.0
    if part_name == "face":
        return 0.12
    return 0.35


def fallback_3d(points_2d: list[list[float]], part_name: str) -> list[list[float]]:
    output = []
    for index, point in enumerate(points_2d):
        x_2d = finite_float(point[0] if len(point) > 0 else 0.0)
        y_2d = finite_float(point[1] if len(point) > 1 else 0.0)
        confidence = finite_float(point[2] if len(point) > 2 else 0.0)
        output.append(
            [
                (x_2d - IMAGE_WIDTH * 0.5) / IMAGE_HEIGHT,
                (y_2d - IMAGE_HEIGHT * 0.5) / IMAGE_HEIGHT,
                -depth_for_part(part_name, index),
                confidence,
            ]
        )
    return output


def infer_people_3d(people: dict[str, Any], model: torch.nn.Module, device: torch.device) -> tuple[dict[str, Any], bool]:
    pose_2d = ensure_points(flat_to_points(people.get("pose_keypoints_2d"), 3), 25, 3)
    face_2d = ensure_points(flat_to_points(people.get("face_keypoints_2d"), 3), FACE_POINT_COUNT, 3)
    left_2d = ensure_points(flat_to_points(people.get("hand_left_keypoints_2d"), 3), HAND_JOINT_COUNT, 3)
    right_2d = ensure_points(flat_to_points(people.get("hand_right_keypoints_2d"), 3), HAND_JOINT_COUNT, 3)

    pose_3d = fallback_3d(pose_2d, "pose")
    face_3d = fallback_3d(face_2d, "face")
    left_3d = fallback_3d(left_2d, "left_hand")
    right_3d = fallback_3d(right_2d, "right_hand")

    processed = False
    x_values = build_model_input(pose_2d, left_2d, right_2d)
    if x_values is not None:
        with torch.no_grad():
            prediction = model(torch.tensor([x_values], dtype=torch.float32, device=device)).detach().cpu().reshape(2, 21).tolist()

        shoulder_center_z = (pose_3d[POSE_LEFT_SHOULDER][2] + pose_3d[POSE_RIGHT_SHOULDER][2]) * 0.5
        shoulder_width_3d = distance_3d(pose_3d[POSE_LEFT_SHOULDER], pose_3d[POSE_RIGHT_SHOULDER])
        if shoulder_width_3d <= 1e-6:
            shoulder_width_3d = 1.0

        for hand_index, hand in enumerate(HAND_ORDER):
            hand_3d = left_3d if hand == "left" else right_3d
            pose_wrist_index = POSE_LEFT_WRIST if hand == "left" else POSE_RIGHT_WRIST
            for joint_index in range(HAND_JOINT_COUNT):
                z_value = shoulder_center_z + float(prediction[hand_index][joint_index]) * shoulder_width_3d
                hand_3d[joint_index][2] = z_value
                if joint_index == 0:
                    pose_3d[pose_wrist_index][2] = z_value
        processed = True

    center, width = shoulder_normalization(pose_3d)
    return {
        "pose_keypoints_2d": flatten(pose_2d),
        "pose_keypoints_3d": flatten(normalize_3d_points(pose_3d, center, width)),
        "hand_left_keypoints_2d": flatten(left_2d),
        "hand_left_keypoints_3d": flatten(normalize_3d_points(left_3d, center, width)),
        "hand_right_keypoints_2d": flatten(right_2d),
        "hand_right_keypoints_3d": flatten(normalize_3d_points(right_3d, center, width)),
        "face_keypoints_2d": flatten(face_2d),
        "face_keypoints_3d": flatten(normalize_3d_points(face_3d, center, width)),
    }, processed


def normalize_existing_people(people: dict[str, Any]) -> dict[str, Any]:
    pose_2d = ensure_points(flat_to_points(people.get("pose_keypoints_2d"), 3), 25, 3)
    face_2d = ensure_points(flat_to_points(people.get("face_keypoints_2d"), 3), FACE_POINT_COUNT, 3)
    left_2d = ensure_points(flat_to_points(people.get("hand_left_keypoints_2d"), 3), HAND_JOINT_COUNT, 3)
    right_2d = ensure_points(flat_to_points(people.get("hand_right_keypoints_2d"), 3), HAND_JOINT_COUNT, 3)
    pose_3d = ensure_points(flat_to_points(people.get("pose_keypoints_3d"), 4), 25, 4)
    face_3d = ensure_points(flat_to_points(people.get("face_keypoints_3d"), 4), FACE_POINT_COUNT, 4)
    left_3d = ensure_points(flat_to_points(people.get("hand_left_keypoints_3d"), 4), HAND_JOINT_COUNT, 4)
    right_3d = ensure_points(flat_to_points(people.get("hand_right_keypoints_3d"), 4), HAND_JOINT_COUNT, 4)
    center, width = shoulder_normalization(pose_3d)
    return {
        "pose_keypoints_2d": flatten(pose_2d),
        "pose_keypoints_3d": flatten(normalize_3d_points(pose_3d, center, width)),
        "hand_left_keypoints_2d": flatten(left_2d),
        "hand_left_keypoints_3d": flatten(normalize_3d_points(left_3d, center, width)),
        "hand_right_keypoints_2d": flatten(right_2d),
        "hand_right_keypoints_3d": flatten(normalize_3d_points(right_3d, center, width)),
        "face_keypoints_2d": flatten(face_2d),
        "face_keypoints_3d": flatten(normalize_3d_points(face_3d, center, width)),
    }


def sequence_id(payload: dict[str, Any], word: str) -> str:
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    value = source.get("sequence_id")
    if value:
        return str(value)
    source_path = source.get("sentence_json") or source.get("keypoint_dir") or ""
    if source_path:
        return Path(str(source_path)).stem
    return sanitize_file_name(word)


def convert_payload(
    payload: dict[str, Any],
    model: torch.nn.Module,
    device: torch.device,
) -> tuple[dict[str, Any], dict[str, Any]]:
    word = normalized_text(payload.get("word"))
    source_kind = payload.get("source", {}).get("kind")
    fps = finite_float((payload.get("segment") or {}).get("fps"), DEFAULT_FPS) if source_kind == "sentence_landmarks_segment" else DEFAULT_FPS
    seq = sequence_id(payload, word)
    frames = []
    inferred = 0
    skipped = 0

    for index, frame in enumerate(payload.get("frames") or []):
        people = frame.get("people") if isinstance(frame.get("people"), dict) else {}
        if source_kind == "sentence_landmarks_segment":
            converted_people, processed = infer_people_3d(people, model, device)
            inferred += int(processed)
            skipped += int(not processed)
        else:
            converted_people = normalize_existing_people(people)
        frames.append({"frame_index": index, "people": converted_people})

    first_source_frame = int(payload["frames"][0].get("source_frame_number", 0)) if payload.get("frames") else 0
    last_source_frame = int(payload["frames"][-1].get("source_frame_number", first_source_frame)) if payload.get("frames") else 0
    segment = payload.get("segment") if isinstance(payload.get("segment"), dict) else {}
    output_segment = {
        "source_start_sec": finite_float(segment.get("padded_start_sec"), first_source_frame / fps),
        "source_end_sec": finite_float(segment.get("padded_end_sec"), (last_source_frame + 1) / fps),
        "source_start_frame": int(segment.get("source_start_frame_index", first_source_frame) or first_source_frame),
        "source_end_frame_exclusive": int(segment.get("source_end_frame_index_exclusive", last_source_frame + 1) or (last_source_frame + 1)),
        "frame_count": len(frames),
    }
    if source_kind == "sentence_landmarks_segment":
        output_segment.update(
            {
                "unpadded_source_start_sec": finite_float(segment.get("source_start_sec")),
                "unpadded_source_end_sec": finite_float(segment.get("source_end_sec")),
                "padding_sec": finite_float(segment.get("padding_sec")),
            }
        )

    depth_source = "estimated_3d" if source_kind == "sentence_landmarks_segment" else "calibrated_3d"
    output = {
        "sample_id": f"{seq}__{sanitize_file_name(word)}__000_00",
        "schema_version": SCHEMA_VERSION,
        "gloss": word,
        "fps": fps,
        "source": {
            "dataset": f"raw_out_{source_kind}",
            "video_id": seq,
            "video_ref": None,
            "source_path": payload.get("source", {}).get("source_dir"),
            "raw_out_source": payload.get("source"),
        },
        "segment": output_segment,
        "processing": {
            "trim_policy": "raw_out_word_segment",
            "cropped_to_segment": True,
            "coordinate_normalization": "shoulder-root-relative/v1",
            "coordinate_root": "shoulder_center_3d",
            "coordinate_scale": "shoulder_width_3d",
            "z_polarity": 1,
            "depth_source": depth_source,
            "estimated_3d_method": "hand_lifting_mlp_v0" if depth_source == "estimated_3d" else None,
            "converted_to_word_dic_schema_at": datetime.now(timezone.utc).isoformat(),
        },
        "frames": frames,
    }
    stats = {
        "word": word,
        "source_kind": source_kind,
        "frame_count": len(frames),
        "depth_source": depth_source,
        "inferred_3d_frames": inferred,
        "skipped_inference_frames": skipped,
    }
    return output, stats


def load_word_dic_map(word_dic_root: Path) -> dict[str, Path]:
    return {normalized_text(path.stem): path for path in word_dic_root.glob("*.json")}


def unprocessed_words(report_path: Path) -> list[str]:
    if not report_path.exists():
        return []
    payload = read_json(report_path)
    return [normalized_text(item.get("folder")) for item in payload.get("unprocessed", []) if item.get("folder")]


def main() -> int:
    args = parse_args()
    input_root = args.input_root.resolve()
    output_root = args.output_root.resolve()
    if not input_root.exists():
        raise FileNotFoundError(input_root)
    if output_root.exists() and args.overwrite:
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    checkpoint, model = load_model(args.checkpoint)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    converted = []
    failed = []
    for path in sorted(input_root.glob("*.json"), key=lambda item: normalized_text(item.stem)):
        if path.name.startswith("_"):
            continue
        try:
            output, stats = convert_payload(read_json(path), model, device)
            output_path = output_root / f"{sanitize_file_name(output['gloss'])}.json"
            write_json(output_path, output, args.indent)
            converted.append({**stats, "output": str(output_path)})
        except Exception as error:  # noqa: BLE001
            failed.append({"source": str(path), "error": str(error)})

    copied_from_word_dic = []
    word_dic_map = load_word_dic_map(args.word_dic_root)
    for word in unprocessed_words(args.unprocessed_report):
        source_path = word_dic_map.get(word)
        if source_path is None:
            failed.append({"word": word, "error": "missing_from_word_dic"})
            continue
        output_path = output_root / f"{sanitize_file_name(word)}.json"
        shutil.copy2(source_path, output_path)
        copied_from_word_dic.append({"word": word, "source": str(source_path), "output": str(output_path)})

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_root": str(input_root),
        "output_root": str(output_root),
        "word_dic_root": str(args.word_dic_root),
        "checkpoint": str(args.checkpoint),
        "checkpoint_epoch": checkpoint.get("epoch"),
        "checkpoint_best_metric": checkpoint.get("best_metric"),
        "device": str(device),
        "converted_count": len(converted),
        "copied_from_word_dic_count": len(copied_from_word_dic),
        "failed_count": len(failed),
        "converted": converted,
        "copied_from_word_dic": copied_from_word_dic,
        "failed": failed,
    }
    write_json(output_root / "_manifest.json", manifest, args.indent)
    print(
        json.dumps(
            {
                "converted_count": len(converted),
                "copied_from_word_dic_count": len(copied_from_word_dic),
                "failed_count": len(failed),
                "output_root": str(output_root),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
