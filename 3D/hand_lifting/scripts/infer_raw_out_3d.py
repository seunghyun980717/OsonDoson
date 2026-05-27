#!/usr/bin/env python3
"""Infer estimated 3D keypoints for the raw_out dataset.

The raw_out corpus JSON files keep 2D COCO WholeBody keypoints under
``landmarks[*].predictions[*].keypoints``. This script copies the dataset to a
new output directory and augments landmark predictions with an ``estimated_3d``
block using the existing hand-lifting MLP checkpoint.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from build_mlp_word_viewer_qa import (  # noqa: E402
    BODY25_COUNT,
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

DEFAULT_INPUT_ROOT = Path("/Users/suwon/SSAFY/2학기/자율/raw_out")
DEFAULT_OUTPUT_NAME = "3d_estimated_v0"
DEFAULT_CHECKPOINT = THREE_D_ROOT / "hand_lifting" / "runs" / "v0_mlp" / "hand_lifting_v0_mlp_best.pt"
IMAGE_WIDTH = 1920
IMAGE_HEIGHT = 1080
FACE_COUNT = 68

COCO_BODY = {
    "nose": 0,
    "left_eye": 1,
    "right_eye": 2,
    "left_ear": 3,
    "right_ear": 4,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16,
    "left_big_toe": 17,
    "left_small_toe": 18,
    "left_heel": 19,
    "right_big_toe": 20,
    "right_small_toe": 21,
    "right_heel": 22,
}

BODY25_TO_COCO = (
    COCO_BODY["nose"],
    None,
    COCO_BODY["right_shoulder"],
    COCO_BODY["right_elbow"],
    COCO_BODY["right_wrist"],
    COCO_BODY["left_shoulder"],
    COCO_BODY["left_elbow"],
    COCO_BODY["left_wrist"],
    None,
    COCO_BODY["right_hip"],
    COCO_BODY["right_knee"],
    COCO_BODY["right_ankle"],
    COCO_BODY["left_hip"],
    COCO_BODY["left_knee"],
    COCO_BODY["left_ankle"],
    COCO_BODY["right_eye"],
    COCO_BODY["left_eye"],
    COCO_BODY["right_ear"],
    COCO_BODY["left_ear"],
    COCO_BODY["left_big_toe"],
    COCO_BODY["left_small_toe"],
    COCO_BODY["left_heel"],
    COCO_BODY["right_big_toe"],
    COCO_BODY["right_small_toe"],
    COCO_BODY["right_heel"],
)

COCO_FACE_START = 23
COCO_LEFT_HAND_START = 91
COCO_RIGHT_HAND_START = 112
COCO_HAND_COUNT = 21


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--indent", type=int, default=2)
    parser.add_argument(
        "--flat-keypoints-only",
        action="store_true",
        help="Write only keypoint JSON files directly under output-root; skip videos, morpheme JSON, and subfolders.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def flat_to_points(values: Any, stride: int) -> list[list[float]]:
    if not isinstance(values, list):
        return []
    points: list[list[float]] = []
    for index in range(0, len(values) - stride + 1, stride):
        points.append([finite_float(values[index + offset]) for offset in range(stride)])
    return points


def average_visible(points: list[list[float]]) -> list[float]:
    visible = [point for point in points if len(point) >= 3 and point[2] > 0]
    if not visible:
        return [0.0, 0.0, 0.0]
    return [
        sum(point[axis] for point in visible) / len(visible)
        for axis in range(3)
    ]


def point_or_zero(points: list[list[float]], index: int | None) -> list[float]:
    if index is None or index >= len(points):
        return [0.0, 0.0, 0.0]
    point = points[index]
    return [
        finite_float(point[0] if len(point) > 0 else 0.0),
        finite_float(point[1] if len(point) > 1 else 0.0),
        finite_float(point[2] if len(point) > 2 else 0.0),
    ]


def convert_coco_wholebody_to_parts(flat_keypoints: Any) -> dict[str, list[list[float]]]:
    coco = flat_to_points(flat_keypoints, 3)
    if len(coco) < COCO_RIGHT_HAND_START + COCO_HAND_COUNT:
        raise ValueError(f"Expected at least 133 COCO WholeBody points, received {len(coco)}")

    pose = [point_or_zero(coco, coco_index) for coco_index in BODY25_TO_COCO]
    pose[1] = average_visible([coco[COCO_BODY["left_shoulder"]], coco[COCO_BODY["right_shoulder"]]])
    pose[8] = average_visible([coco[COCO_BODY["left_hip"]], coco[COCO_BODY["right_hip"]]])

    return {
        "pose": pose,
        "face": [point_or_zero(coco, index) for index in range(COCO_FACE_START, COCO_FACE_START + FACE_COUNT)],
        "left_hand": [
            point_or_zero(coco, index)
            for index in range(COCO_LEFT_HAND_START, COCO_LEFT_HAND_START + COCO_HAND_COUNT)
        ],
        "right_hand": [
            point_or_zero(coco, index)
            for index in range(COCO_RIGHT_HAND_START, COCO_RIGHT_HAND_START + COCO_HAND_COUNT)
        ],
    }


def pose_depth(index: int) -> float:
    if index in (0, 15, 16, 17, 18):
        return 0.12
    if index in (3, 6):
        return 0.22
    if index in (4, 7):
        return 0.30
    return 0.0


def depth_for_part(part_name: str, index: int) -> float:
    if part_name == "pose":
        return pose_depth(index)
    if part_name == "face":
        return 0.12
    return 0.35


def fallback_3d(points_2d: list[list[float]], part_name: str, width: float, height: float) -> list[list[float]]:
    coordinate_scale = max(1.0, height)
    output: list[list[float]] = []
    for index, point in enumerate(points_2d):
        x_2d = finite_float(point[0] if len(point) > 0 else 0.0)
        y_2d = finite_float(point[1] if len(point) > 1 else 0.0)
        confidence = finite_float(point[2] if len(point) > 2 else 0.0)
        output.append(
            [
                round((x_2d - width * 0.5) / coordinate_scale, 6),
                round((y_2d - height * 0.5) / coordinate_scale, 6),
                round(-depth_for_part(part_name, index), 6),
                round(confidence, 6),
            ]
        )
    return output


def flatten_part(points: list[list[float]]) -> list[float]:
    return [finite_float(value) for point in points for value in point]


def has_openpose_keypoints(payload: dict[str, Any]) -> bool:
    people = payload.get("people")
    if not isinstance(people, dict):
        return False
    return all(
        isinstance(people.get(key), list)
        for key in ("pose_keypoints_2d", "hand_left_keypoints_2d", "hand_right_keypoints_2d")
    )


def has_openpose_3d(payload: dict[str, Any]) -> bool:
    people = payload.get("people")
    if not isinstance(people, dict):
        return False
    return all(
        isinstance(people.get(key), list) and bool(people.get(key))
        for key in ("pose_keypoints_3d", "hand_left_keypoints_3d", "hand_right_keypoints_3d")
    )


def flat_output_name(source_path: Path, input_root: Path) -> str:
    relative = source_path.relative_to(input_root)
    word = relative.parts[0] if relative.parts else source_path.parent.name
    if source_path.name.endswith("_keypoints.json"):
        return f"{word}__{source_path.name}"
    return f"{word}__{source_path.stem}_keypoints_3d.json"


def infer_parts(
    parts_2d: dict[str, list[list[float]]],
    model: torch.nn.Module,
    device: torch.device,
    width: float,
    height: float,
) -> tuple[dict[str, list[list[float]]], bool]:
    estimated = {
        part_name: fallback_3d(points, part_name, width, height)
        for part_name, points in parts_2d.items()
    }
    x_values = build_model_input(parts_2d["pose"], parts_2d["left_hand"], parts_2d["right_hand"])
    if x_values is None:
        return estimated, False

    with torch.no_grad():
        x_tensor = torch.tensor([x_values], dtype=torch.float32, device=device)
        prediction = model(x_tensor).detach().cpu().reshape(2, 21).tolist()

    pose_3d = estimated["pose"]
    shoulder_center_z = (pose_3d[POSE_LEFT_SHOULDER][2] + pose_3d[POSE_RIGHT_SHOULDER][2]) * 0.5
    shoulder_width_3d = distance_3d(pose_3d[POSE_LEFT_SHOULDER], pose_3d[POSE_RIGHT_SHOULDER])
    if shoulder_width_3d <= 1e-6:
        shoulder_width_3d = 1.0

    for hand_index, hand in enumerate(HAND_ORDER):
        hand_3d = estimated["left_hand"] if hand == "left" else estimated["right_hand"]
        pose_wrist_index = POSE_LEFT_WRIST if hand == "left" else POSE_RIGHT_WRIST
        for joint_index in range(HAND_JOINT_COUNT):
            z_value = shoulder_center_z + float(prediction[hand_index][joint_index]) * shoulder_width_3d
            hand_3d[joint_index][2] = round(z_value, 6)
            if joint_index == 0:
                pose_3d[pose_wrist_index][2] = round(z_value, 6)

    return estimated, True


def augment_landmark_json(
    payload: dict[str, Any],
    model: torch.nn.Module,
    checkpoint: dict[str, Any],
    device: torch.device,
    source_path: Path,
    checkpoint_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    output = copy.deepcopy(payload)
    width = finite_float(output.get("potogrf", {}).get("width"), IMAGE_WIDTH)
    height = finite_float(output.get("potogrf", {}).get("height"), IMAGE_HEIGHT)
    processed = 0
    skipped = 0
    prediction_count = 0
    errors: list[str] = []

    for frame in output.get("landmarks") or []:
        for prediction in frame.get("predictions") or []:
            prediction_count += 1
            try:
                parts_2d = convert_coco_wholebody_to_parts(prediction.get("keypoints"))
                estimated, did_process = infer_parts(parts_2d, model, device, width, height)
            except Exception as error:  # noqa: BLE001 - keep the batch going and report the sample.
                skipped += 1
                if len(errors) < 5:
                    errors.append(str(error))
                continue

            processed += int(did_process)
            skipped += int(not did_process)
            prediction["estimated_3d"] = {
                "layout": "body25_face68_hands21",
                "coordinate_space": "viewer_normalized_xy_with_hand_lifting_mlp_v0_z",
                "pose_keypoints_3d": flatten_part(estimated["pose"]),
                "face_keypoints_3d": flatten_part(estimated["face"]),
                "hand_left_keypoints_3d": flatten_part(estimated["left_hand"]),
                "hand_right_keypoints_3d": flatten_part(estimated["right_hand"]),
            }

    output["estimated_3d_metadata"] = {
        "method": "hand_lifting_mlp_v0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_file": str(source_path),
        "checkpoint": str(checkpoint_path),
        "checkpoint_epoch": checkpoint.get("epoch"),
        "checkpoint_best_metric": checkpoint.get("best_metric"),
        "prediction_count": prediction_count,
        "processed_count": processed,
        "skipped_count": skipped,
        "errors_sample": errors,
    }
    return output, {
        "status": "processed",
        "prediction_count": prediction_count,
        "processed_count": processed,
        "skipped_count": skipped,
        "errors_sample": errors,
    }


def should_skip_output_path(path: Path, input_root: Path, output_root: Path) -> bool:
    try:
        path.relative_to(output_root)
        return True
    except ValueError:
        pass
    return path == input_root


def main() -> int:
    args = parse_args()
    input_root = args.input_root.resolve()
    output_root = (args.output_root or (input_root / DEFAULT_OUTPUT_NAME)).resolve()
    if not input_root.exists():
        raise FileNotFoundError(input_root)
    if output_root.exists():
        if not args.overwrite:
            raise FileExistsError(f"Output already exists: {output_root}. Pass --overwrite to replace it.")
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    checkpoint, model = load_model(args.checkpoint)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    manifest: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_root": str(input_root),
        "output_root": str(output_root),
        "checkpoint": str(args.checkpoint),
        "device": str(device),
        "files": [],
        "summary": {
            "json_total": 0,
            "landmark_json_processed": 0,
            "openpose_keypoint_json_copied": 0,
            "json_copied_without_landmarks": 0,
            "json_skipped_non_keypoint": 0,
            "non_json_copied": 0,
            "non_json_skipped": 0,
            "prediction_count": 0,
            "processed_count": 0,
            "skipped_count": 0,
            "failed_json_count": 0,
        },
    }

    for source_path in sorted(input_root.rglob("*")):
        if should_skip_output_path(source_path, input_root, output_root):
            continue
        relative_path = source_path.relative_to(input_root)
        destination_path = output_root / relative_path
        if source_path.is_dir():
            if args.flat_keypoints_only:
                continue
            destination_path.mkdir(parents=True, exist_ok=True)
            continue
        if not source_path.is_file():
            continue

        if args.flat_keypoints_only:
            if source_path.suffix.lower() != ".json":
                manifest["summary"]["non_json_skipped"] += 1
                continue

            manifest["summary"]["json_total"] += 1
            try:
                payload = read_json(source_path)
            except Exception as error:  # noqa: BLE001
                manifest["summary"]["failed_json_count"] += 1
                manifest["files"].append(
                    {
                        "source": str(source_path),
                        "status": "failed_invalid_json",
                        "error": str(error),
                    }
                )
                continue

            destination_path = output_root / flat_output_name(source_path, input_root)
            if isinstance(payload.get("landmarks"), list):
                augmented, result = augment_landmark_json(payload, model, checkpoint, device, source_path, args.checkpoint)
                write_json(destination_path, augmented, args.indent)
                manifest["summary"]["landmark_json_processed"] += 1
                manifest["summary"]["prediction_count"] += result["prediction_count"]
                manifest["summary"]["processed_count"] += result["processed_count"]
                manifest["summary"]["skipped_count"] += result["skipped_count"]
                manifest["files"].append({"source": str(source_path), "output": str(destination_path), **result})
            elif has_openpose_keypoints(payload) and has_openpose_3d(payload):
                write_json(destination_path, payload, args.indent)
                manifest["summary"]["openpose_keypoint_json_copied"] += 1
                manifest["files"].append(
                    {
                        "source": str(source_path),
                        "output": str(destination_path),
                        "status": "copied_existing_3d_keypoints",
                    }
                )
            else:
                manifest["summary"]["json_skipped_non_keypoint"] += 1
            continue

        if source_path.suffix.lower() != ".json":
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, destination_path)
            manifest["summary"]["non_json_copied"] += 1
            continue

        manifest["summary"]["json_total"] += 1
        try:
            payload = read_json(source_path)
        except Exception as error:  # noqa: BLE001
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, destination_path)
            manifest["summary"]["failed_json_count"] += 1
            manifest["files"].append(
                {
                    "source": str(source_path),
                    "output": str(destination_path),
                    "status": "copied_invalid_json",
                    "error": str(error),
                }
            )
            continue

        if isinstance(payload.get("landmarks"), list):
            augmented, result = augment_landmark_json(payload, model, checkpoint, device, source_path, args.checkpoint)
            write_json(destination_path, augmented, args.indent)
            manifest["summary"]["landmark_json_processed"] += 1
            manifest["summary"]["prediction_count"] += result["prediction_count"]
            manifest["summary"]["processed_count"] += result["processed_count"]
            manifest["summary"]["skipped_count"] += result["skipped_count"]
            manifest["files"].append({"source": str(source_path), "output": str(destination_path), **result})
        else:
            write_json(destination_path, payload, args.indent)
            manifest["summary"]["json_copied_without_landmarks"] += 1
            manifest["files"].append(
                {
                    "source": str(source_path),
                    "output": str(destination_path),
                    "status": "copied_without_landmarks",
                    "reason": "no landmarks keypoints available for 3d inference",
                }
            )

    if not args.flat_keypoints_only:
        write_json(output_root / "manifest_3d_estimation.json", manifest, args.indent)
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    print(f"Wrote {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
