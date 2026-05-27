#!/usr/bin/env python3
"""Create word-viewer QA JSON files with v0 MLP estimated_3d blocks.

The current viewer reads word JSON files from ``3D/data/words`` and renders
``estimated_3d`` before falling back to ``calibrated_3d`` or ``depth_hint``.
This script creates a small set of copied QA words named ``mlp_QA_*`` and
injects hand-lifting MLP z estimates into their ``sample.keypoints.estimated_3d``.
Original source word JSON files are not modified.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from torch import nn

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from build_hand_lifting_dataset import (  # noqa: E402
    HAND_JOINT_COUNT,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_WRIST,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_WRIST,
    arm_extension_2d,
    hand_palm_center_2d,
    hand_size_2d,
    normalize_hand_2d,
    normalize_point_2d,
    normalize_points_2d,
    parse_point_2d,
    torso_bbox_2d,
    torso_overlap_score,
    valid_2d,
)
from train_hand_lifting_mlp_v0 import (  # noqa: E402
    HAND_ORDER,
    INPUT_LAYOUT,
    TARGET_LAYOUT,
    flatten_derived,
    flatten_points,
)

POSE_NECK = 1
POSE_RIGHT_ELBOW = 3
POSE_LEFT_ELBOW = 6
POSE_MID_HIP = 8
POSE_INPUT_INDICES = (0, 1, 2, 3, 4, 5, 6, 7, 15, 16, 17)
BODY25_COUNT = 25
FACE_COUNT = 70
DERIVED_ORDER = INPUT_LAYOUT["derived_order"]

DEFAULT_WORDS = (
    "0",
    "LG전자(전기)",
    "가능",
    "각각",
    "가족",
    "가게",
    "감사",
    "확인",
    "핸드폰",
    "ARS",
)


class HandLiftMLP(nn.Module):
    def __init__(self, input_dim: int, hidden_dims: list[int], output_dim: int, dropout: float) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        prev_dim = input_dim
        for hidden_dim in hidden_dims:
            layers.append(nn.Linear(prev_dim, hidden_dim))
            layers.append(nn.LayerNorm(hidden_dim))
            layers.append(nn.GELU())
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = hidden_dim
        layers.append(nn.Linear(prev_dim, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--word-root",
        type=Path,
        default=THREE_D_ROOT / "data" / "words",
        help="Viewer word JSON root. Default: 3D/data/words.",
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=THREE_D_ROOT / "hand_lifting" / "runs" / "v0_mlp" / "hand_lifting_v0_mlp_best.pt",
        help="v0 MLP best checkpoint path.",
    )
    parser.add_argument(
        "--words",
        nargs="+",
        default=list(DEFAULT_WORDS),
        help="Source word names without .json. The first item should be 0 for QA coverage.",
    )
    parser.add_argument("--prefix", default="mlp_QA", help="Generated QA filename/title prefix.")
    parser.add_argument("--limit", type=int, default=10, help="Number of QA words to generate.")
    parser.add_argument("--clean", action="store_true", help="Remove existing prefix*.json files before generation.")
    parser.add_argument("--all-words", action="store_true", help="Generate QA copies for all source word JSON files.")
    parser.add_argument(
        "--exclude-prefix",
        nargs="+",
        default=["mlp_QA"],
        help="Filename stems with these prefixes are excluded when --all-words is used.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip QA files that already exist instead of overwriting them.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Optional JSON manifest path for generated QA copies.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def natural_key(value: str) -> list[tuple[int, Any]]:
    parts: list[tuple[int, Any]] = []
    current = ""
    is_digit = False
    for char in value:
        char_is_digit = char.isdigit()
        if current and char_is_digit != is_digit:
            parts.append((0, int(current)) if is_digit else (1, current.lower()))
            current = ""
        current += char
        is_digit = char_is_digit
    if current:
        parts.append((0, int(current)) if is_digit else (1, current.lower()))
    return parts


def discover_source_words(word_root: Path, exclude_prefixes: list[str]) -> list[str]:
    words: list[str] = []
    for path in word_root.glob("*.json"):
        if not path.is_file():
            continue
        stem = path.stem
        if any(stem.startswith(prefix) for prefix in exclude_prefixes):
            continue
        words.append(stem)
    words.sort(key=natural_key)
    if "0" in words:
        words.remove("0")
        words.insert(0, "0")
    return words


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def values_for(block: dict[str, Any], part_name: str) -> list[Any]:
    values = ((block or {}).get(part_name) or {}).get("values")
    return values if isinstance(values, list) else []


def shape_block(values: list[Any], point_count: int, components: int) -> dict[str, Any]:
    return {"shape": [len(values), point_count, components], "values": values}


def flatten_2d(points: list[Any]) -> list[float]:
    flat: list[float] = []
    for point in points:
        flat.extend(
            [
                finite_float(point[0] if len(point) > 0 else 0.0),
                finite_float(point[1] if len(point) > 1 else 0.0),
                finite_float(point[2] if len(point) > 2 else 0.0),
            ]
        )
    return flat


def distance_2d(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def distance_3d(a: list[float], b: list[float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def safe_point(frame: list[Any], index: int, dims: int) -> list[float]:
    if not isinstance(frame, list) or index >= len(frame) or not isinstance(frame[index], list):
        return [0.0] * dims
    point = frame[index]
    return [finite_float(point[i] if i < len(point) else 0.0) for i in range(dims)]


def fallback_3d(image_frame: list[Any], depth_frame: list[Any], image_space: dict[str, Any]) -> list[list[float]]:
    width = finite_float(image_space.get("width"), 1920.0)
    height = finite_float(image_space.get("height"), 1080.0)
    coordinate_scale = max(1.0, height)
    output: list[list[float]] = []
    for index, _ in enumerate(image_frame or []):
        x_2d, y_2d, conf_2d = safe_point(image_frame, index, 3)
        depth_z, depth_conf = safe_point(depth_frame, index, 2)
        output.append(
            [
                round((x_2d - width * 0.5) / coordinate_scale, 6),
                round((y_2d - height * 0.5) / coordinate_scale, 6),
                round(-depth_z, 6),
                round(min(conf_2d, depth_conf if depth_conf else conf_2d), 6),
            ]
        )
    return output


def build_model_input(pose_frame: list[Any], left_frame: list[Any], right_frame: list[Any]) -> list[float] | None:
    pose_flat = flatten_2d(pose_frame)
    left_flat = flatten_2d(left_frame)
    right_flat = flatten_2d(right_frame)
    left_shoulder = parse_point_2d(pose_flat, POSE_LEFT_SHOULDER)
    right_shoulder = parse_point_2d(pose_flat, POSE_RIGHT_SHOULDER)
    if not valid_2d(left_shoulder) or not valid_2d(right_shoulder):
        return None
    assert left_shoulder is not None and right_shoulder is not None
    shoulder_width_2d = distance_2d(left_shoulder, right_shoulder)
    if shoulder_width_2d <= 1e-6:
        return None

    center_x = (left_shoulder[0] + right_shoulder[0]) * 0.5
    center_y = (left_shoulder[1] + right_shoulder[1]) * 0.5
    torso_bbox = torso_bbox_2d(pose_flat)
    derived = {
        "left_palm_center_2d_norm": normalize_point_2d(
            hand_palm_center_2d(left_flat), center_x, center_y, shoulder_width_2d
        ),
        "right_palm_center_2d_norm": normalize_point_2d(
            hand_palm_center_2d(right_flat), center_x, center_y, shoulder_width_2d
        ),
        "left_hand_size_2d": hand_size_2d(left_flat, shoulder_width_2d),
        "right_hand_size_2d": hand_size_2d(right_flat, shoulder_width_2d),
        "left_arm_extension_2d": arm_extension_2d(pose_flat, POSE_LEFT_SHOULDER, POSE_LEFT_WRIST, shoulder_width_2d),
        "right_arm_extension_2d": arm_extension_2d(pose_flat, POSE_RIGHT_SHOULDER, POSE_RIGHT_WRIST, shoulder_width_2d),
        "left_torso_overlap_score": torso_overlap_score(left_flat, torso_bbox),
        "right_torso_overlap_score": torso_overlap_score(right_flat, torso_bbox),
    }
    x_values = (
        flatten_points(normalize_points_2d(pose_flat, POSE_INPUT_INDICES, center_x, center_y, shoulder_width_2d))
        + flatten_points(normalize_hand_2d(left_flat, center_x, center_y, shoulder_width_2d))
        + flatten_points(normalize_hand_2d(right_flat, center_x, center_y, shoulder_width_2d))
        + flatten_derived(derived)
    )
    if len(x_values) != INPUT_LAYOUT["input_dim"]:
        raise ValueError(f"Unexpected input dim: {len(x_values)}")
    return x_values


def load_model(checkpoint_path: Path) -> tuple[dict[str, Any], HandLiftMLP]:
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    model_config = (checkpoint.get("config") or {}).get("model") or {}
    model = HandLiftMLP(
        INPUT_LAYOUT["input_dim"],
        model_config.get("hidden_dims") or [256, 256, 128],
        TARGET_LAYOUT["output_dim"],
        float(model_config.get("dropout", 0.05)),
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return checkpoint, model


def build_estimated_word(
    payload: dict[str, Any],
    model: HandLiftMLP,
    checkpoint: dict[str, Any],
    device: torch.device,
    qa_word: str,
    source_word: str,
) -> dict[str, Any]:
    sample = payload["sample"]
    keypoints = sample["keypoints"]
    spaces = sample.setdefault("spaces", {})
    processing = sample.setdefault("processing", {})
    image_2d = keypoints["image_2d"]
    depth_hint = keypoints.get("depth_hint") or {}
    image_space = spaces.get("image_2d") or {}

    pose_2d = values_for(image_2d, "pose")
    left_2d = values_for(image_2d, "left_hand")
    right_2d = values_for(image_2d, "right_hand")
    face_2d = values_for(image_2d, "face")
    pose_depth = values_for(depth_hint, "pose")
    left_depth = values_for(depth_hint, "left_hand")
    right_depth = values_for(depth_hint, "right_hand")
    face_depth = values_for(depth_hint, "face")
    frame_count = int((sample.get("segment") or {}).get("frame_count") or len(pose_2d))

    estimated_pose: list[Any] = []
    estimated_left: list[Any] = []
    estimated_right: list[Any] = []
    estimated_face: list[Any] = []
    processed = 0
    skipped = 0

    for frame_index in range(frame_count):
        pose_3d = fallback_3d(pose_2d[frame_index], pose_depth[frame_index] if frame_index < len(pose_depth) else [], image_space)
        left_3d = fallback_3d(left_2d[frame_index], left_depth[frame_index] if frame_index < len(left_depth) else [], image_space)
        right_3d = fallback_3d(right_2d[frame_index], right_depth[frame_index] if frame_index < len(right_depth) else [], image_space)
        face_3d = fallback_3d(face_2d[frame_index], face_depth[frame_index] if frame_index < len(face_depth) else [], image_space)

        x_values = build_model_input(pose_2d[frame_index], left_2d[frame_index], right_2d[frame_index])
        if x_values is None:
            skipped += 1
        else:
            with torch.no_grad():
                x_tensor = torch.tensor([x_values], dtype=torch.float32, device=device)
                pred = model(x_tensor).detach().cpu().reshape(2, 21).tolist()

            shoulder_center_z = (pose_3d[POSE_LEFT_SHOULDER][2] + pose_3d[POSE_RIGHT_SHOULDER][2]) * 0.5
            shoulder_width_3d = distance_3d(pose_3d[POSE_LEFT_SHOULDER], pose_3d[POSE_RIGHT_SHOULDER])
            if shoulder_width_3d <= 1e-6:
                shoulder_width_3d = 1.0

            for hand_index, hand in enumerate(HAND_ORDER):
                hand_3d = left_3d if hand == "left" else right_3d
                pose_wrist_index = POSE_LEFT_WRIST if hand == "left" else POSE_RIGHT_WRIST
                for joint_index in range(HAND_JOINT_COUNT):
                    z = shoulder_center_z + float(pred[hand_index][joint_index]) * shoulder_width_3d
                    hand_3d[joint_index][2] = round(z, 6)
                    if joint_index == 0:
                        pose_3d[pose_wrist_index][2] = round(z, 6)
            processed += 1

        estimated_pose.append(pose_3d)
        estimated_left.append(left_3d)
        estimated_right.append(right_3d)
        estimated_face.append(face_3d)

    keypoints["estimated_3d"] = {
        "pose": shape_block(estimated_pose, BODY25_COUNT, 4),
        "left_hand": shape_block(estimated_left, HAND_JOINT_COUNT, 4),
        "right_hand": shape_block(estimated_right, HAND_JOINT_COUNT, 4),
        "face": shape_block(estimated_face, FACE_COUNT, 4),
    }
    spaces["estimated_3d"] = {
        "available": True,
        "coordinate_space": "viewer_normalized_xy_with_hand_lifting_mlp_v0_z",
    }
    spaces["depth_source"] = "estimated_3d"
    processing["estimated_3d_method"] = "hand_lifting_mlp_v0"
    processing["estimated_3d_checkpoint_epoch"] = checkpoint.get("epoch")
    processing["estimated_3d_best_metric"] = checkpoint.get("best_metric")
    processing["estimated_3d_created_at"] = datetime.now(timezone.utc).isoformat()
    processing["estimated_3d_frame_count_processed"] = processed
    processing["estimated_3d_frame_count_skipped"] = skipped
    payload["word"] = qa_word
    payload["viewer_qa_alias"] = {
        "source_word": source_word,
        "purpose": "hand_lifting_v0_estimated_3d_word_viewer_qa",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def main() -> int:
    args = parse_args()
    if args.all_words:
        words = discover_source_words(args.word_root, args.exclude_prefix)
        if args.limit > 0:
            words = words[: args.limit]
    else:
        words = list(args.words[: args.limit])
        if "0" not in words:
            words = ["0", *words]
        words = words[: args.limit]
        if len(words) != args.limit:
            raise ValueError(f"Expected {args.limit} words, got {len(words)}")
        if words[0] != "0":
            words.remove("0")
            words.insert(0, "0")

    if args.clean:
        for path in args.word_root.glob(f"{args.prefix}*.json"):
            path.unlink()

    checkpoint, model = load_model(args.checkpoint)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    created = []
    skipped_existing = []
    failed = []
    for index, source_word in enumerate(words):
        source_path = args.word_root / f"{source_word}.json"
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        qa_word = f"{args.prefix}_{index:02d}_{source_word}"
        output_path = args.word_root / f"{qa_word}.json"
        if args.skip_existing and output_path.exists():
            skipped_existing.append(
                {
                    "source_word": source_word,
                    "qa_word": qa_word,
                    "output": str(output_path),
                }
            )
            continue
        try:
            payload = build_estimated_word(load_json(source_path), model, checkpoint, device, qa_word, source_word)
            write_json(output_path, payload)
            created.append(
                {
                    "source_word": source_word,
                    "qa_word": qa_word,
                    "output": str(output_path),
                    "processed": payload["sample"]["processing"]["estimated_3d_frame_count_processed"],
                    "skipped": payload["sample"]["processing"]["estimated_3d_frame_count_skipped"],
                }
            )
        except Exception as error:  # noqa: BLE001 - keep batch generation going and report failures.
            failed.append(
                {
                    "source_word": source_word,
                    "qa_word": qa_word,
                    "output": str(output_path),
                    "error": str(error),
                }
            )

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "device": str(device),
        "word_root": str(args.word_root),
        "checkpoint": str(args.checkpoint),
        "prefix": args.prefix,
        "all_words": args.all_words,
        "requested_count": len(words),
        "created_count": len(created),
        "skipped_existing_count": len(skipped_existing),
        "failed_count": len(failed),
        "created": created,
        "skipped_existing": skipped_existing,
        "failed": failed,
    }
    if args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.manifest, manifest)

    if args.all_words or args.manifest:
        print(
            json.dumps(
                {
                    "device": str(device),
                    "requested_count": len(words),
                    "created_count": len(created),
                    "skipped_existing_count": len(skipped_existing),
                    "failed_count": len(failed),
                    "manifest": str(args.manifest) if args.manifest else None,
                    "first_created": created[:3],
                    "first_failed": failed[:3],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(json.dumps({"created": created, "device": str(device)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
