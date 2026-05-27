#!/usr/bin/env python3
"""Create word-viewer QA JSON files with TCN v1 center estimated_3d blocks.

This script copies existing source word JSON files and injects TCN v1
``estimated_3d`` values for viewer QA. Source files are not modified.
By default it mirrors the existing ``mlp_v0_5_QA_full_*`` selection so the
viewer can compare MLP v0.5 and TCN v1 on the same words.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_WORD_ROOT = THREE_D_ROOT / "data" / "words"
DEFAULT_CHECKPOINT = THREE_D_ROOT / "hand_lifting" / "runs" / "tcn_v1_center" / "hand_lifting_tcn_v1_best.pt"
DEFAULT_MANIFEST = THREE_D_ROOT / "hand_lifting" / "runs" / "tcn_v1_center" / "tcn_v1_center_viewer_qa_manifest.json"

sys.path.insert(0, str(SCRIPT_DIR))

from build_mlp_v0_5_word_viewer_qa import (  # noqa: E402
    BODY25_COUNT,
    FACE_COUNT,
    HAND_JOINT_COUNT,
    POSE_LEFT_ELBOW,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_WRIST,
    POSE_RIGHT_ELBOW,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_WRIST,
    build_model_input,
    distance_3d,
    fallback_3d,
    load_json,
    shape_block,
    values_for,
    write_json,
)
from train_hand_lifting_tcn_v1 import (  # noqa: E402
    HAND_ORDER,
    INPUT_LAYOUT,
    TARGET_INDEX_BY_NAME,
    TARGET_LAYOUT,
    HandLiftTCN,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", type=Path, default=DEFAULT_WORD_ROOT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--prefix", default="tcn_v1_center_QA_full")
    parser.add_argument(
        "--match-prefix",
        default="mlp_v0_5_QA_full",
        help="Existing QA prefix whose source words should be mirrored.",
    )
    parser.add_argument(
        "--source-mode",
        choices=("original", "matched-copy"),
        default="original",
        help="Use original source word JSON or the matched QA copy as inference input.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional cap after mirrored QA files are sorted.")
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--window-size", type=int, default=15)
    parser.add_argument("--center-index", type=int, default=7)
    parser.add_argument("--channels", type=int, default=384)
    parser.add_argument("--blocks", type=int, default=5)
    parser.add_argument("--kernel-size", type=int, default=3)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--clean", action="store_true", help="Remove existing prefix*.json files first.")
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    return parser.parse_args()


def load_tcn_model(args: argparse.Namespace) -> tuple[dict[str, Any], HandLiftTCN]:
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model_config = (checkpoint.get("config") or {}).get("model") or {}
    model = HandLiftTCN(
        input_dim=INPUT_LAYOUT["input_dim"],
        output_dim=TARGET_LAYOUT["output_dim"],
        channels=int(model_config.get("channels", args.channels)),
        blocks=int(model_config.get("blocks", args.blocks)),
        kernel_size=int(model_config.get("kernel_size", args.kernel_size)),
        dropout=float(model_config.get("dropout", args.dropout)),
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return checkpoint, model


def mirrored_sources(word_root: Path, match_prefix: str, limit: int) -> list[dict[str, Any]]:
    pattern = re.compile(rf"^{re.escape(match_prefix)}_(\d+)_(.+)\.json$")
    sources: list[dict[str, Any]] = []
    for path in word_root.glob(f"{match_prefix}_*.json"):
        match = pattern.match(path.name)
        if not match:
            continue
        source_word = match.group(2)
        try:
            payload = load_json(path)
            source_word = ((payload.get("viewer_qa_alias") or {}).get("source_word")) or source_word
        except Exception:  # noqa: BLE001 - filename fallback is enough for discovery.
            pass
        sources.append({"index": int(match.group(1)), "source_word": source_word, "matched_file": str(path)})
    sources.sort(key=lambda item: item["index"])
    if limit > 0:
        sources = sources[:limit]
    return sources


def fill_feature(features: list[list[float] | None], index: int, fallback: list[float]) -> list[float]:
    frame_count = len(features)
    if frame_count == 0:
        return fallback
    index = max(0, min(frame_count - 1, index))
    feature = features[index]
    if feature is not None:
        return feature
    for delta in range(1, frame_count):
        left = index - delta
        right = index + delta
        if left >= 0 and features[left] is not None:
            return features[left]  # type: ignore[return-value]
        if right < frame_count and features[right] is not None:
            return features[right]  # type: ignore[return-value]
    return fallback


def predict_windows(
    model: HandLiftTCN,
    features: list[list[float] | None],
    device: torch.device,
    window_size: int,
    center_index: int,
    batch_size: int,
) -> dict[int, list[float]]:
    predictions: dict[int, list[float]] = {}
    if not features:
        return predictions
    zero_feature = [0.0] * INPUT_LAYOUT["input_dim"]
    windows: list[list[list[float]]] = []
    frame_indices: list[int] = []
    for frame_index, center_feature in enumerate(features):
        if center_feature is None:
            continue
        window: list[list[float]] = []
        for window_index in range(window_size):
            source_index = frame_index + window_index - center_index
            window.append(fill_feature(features, source_index, center_feature or zero_feature))
        windows.append(window)
        frame_indices.append(frame_index)

    with torch.no_grad():
        for start in range(0, len(windows), batch_size):
            batch_windows = windows[start : start + batch_size]
            x_tensor = torch.tensor(batch_windows, dtype=torch.float32, device=device)
            pred = model(x_tensor)[:, center_index, :].detach().cpu().tolist()
            for frame_index, pred_values in zip(frame_indices[start : start + batch_size], pred, strict=True):
                predictions[frame_index] = [float(value) for value in pred_values]
    return predictions


def apply_prediction_to_frame(
    pred: list[float],
    pose_3d: list[list[float]],
    left_3d: list[list[float]],
    right_3d: list[list[float]],
) -> None:
    shoulder_center_z = (pose_3d[POSE_LEFT_SHOULDER][2] + pose_3d[POSE_RIGHT_SHOULDER][2]) * 0.5
    shoulder_width_3d = distance_3d(pose_3d[POSE_LEFT_SHOULDER], pose_3d[POSE_RIGHT_SHOULDER])
    if shoulder_width_3d <= 1e-6:
        shoulder_width_3d = 1.0

    for label, pose_index in (
        ("left_shoulder", POSE_LEFT_SHOULDER),
        ("right_shoulder", POSE_RIGHT_SHOULDER),
        ("left_elbow", POSE_LEFT_ELBOW),
        ("right_elbow", POSE_RIGHT_ELBOW),
        ("left_wrist", POSE_LEFT_WRIST),
        ("right_wrist", POSE_RIGHT_WRIST),
    ):
        z = shoulder_center_z + pred[TARGET_INDEX_BY_NAME[label]] * shoulder_width_3d
        pose_3d[pose_index][2] = round(z, 6)

    for hand in HAND_ORDER:
        hand_3d = left_3d if hand == "left" else right_3d
        pose_wrist_index = POSE_LEFT_WRIST if hand == "left" else POSE_RIGHT_WRIST
        hand_3d[0][2] = pose_3d[pose_wrist_index][2]
        for joint_index in range(1, HAND_JOINT_COUNT):
            key = f"{hand}_hand_{joint_index}"
            z = shoulder_center_z + pred[TARGET_INDEX_BY_NAME[key]] * shoulder_width_3d
            hand_3d[joint_index][2] = round(z, 6)


def build_estimated_word(
    payload: dict[str, Any],
    model: HandLiftTCN,
    checkpoint: dict[str, Any],
    device: torch.device,
    args: argparse.Namespace,
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

    features: list[list[float] | None] = []
    for frame_index in range(frame_count):
        if frame_index >= len(pose_2d) or frame_index >= len(left_2d) or frame_index >= len(right_2d):
            features.append(None)
            continue
        features.append(build_model_input(pose_2d[frame_index], left_2d[frame_index], right_2d[frame_index]))
    predictions = predict_windows(model, features, device, args.window_size, args.center_index, args.batch_size)

    estimated_pose: list[Any] = []
    estimated_left: list[Any] = []
    estimated_right: list[Any] = []
    estimated_face: list[Any] = []
    processed = 0
    skipped = 0

    for frame_index in range(frame_count):
        pose_frame = pose_2d[frame_index] if frame_index < len(pose_2d) else []
        left_frame = left_2d[frame_index] if frame_index < len(left_2d) else []
        right_frame = right_2d[frame_index] if frame_index < len(right_2d) else []
        face_frame = face_2d[frame_index] if frame_index < len(face_2d) else []
        pose_3d = fallback_3d(pose_frame, pose_depth[frame_index] if frame_index < len(pose_depth) else [], image_space)
        left_3d = fallback_3d(left_frame, left_depth[frame_index] if frame_index < len(left_depth) else [], image_space)
        right_3d = fallback_3d(right_frame, right_depth[frame_index] if frame_index < len(right_depth) else [], image_space)
        face_3d = fallback_3d(face_frame, face_depth[frame_index] if frame_index < len(face_depth) else [], image_space)

        pred = predictions.get(frame_index)
        if pred is None:
            skipped += 1
        else:
            apply_prediction_to_frame(pred, pose_3d, left_3d, right_3d)
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
        "coordinate_space": "viewer_normalized_xy_with_hand_lifting_tcn_v1_center_z",
    }
    spaces["depth_source"] = "estimated_3d"
    processing["estimated_3d_method"] = "hand_lifting_tcn_v1_center"
    processing["estimated_3d_checkpoint_epoch"] = checkpoint.get("epoch")
    processing["estimated_3d_best_metric"] = checkpoint.get("best_metric")
    processing["estimated_3d_created_at"] = datetime.now(timezone.utc).isoformat()
    processing["estimated_3d_window_size"] = args.window_size
    processing["estimated_3d_center_index"] = args.center_index
    processing["estimated_3d_frame_count_processed"] = processed
    processing["estimated_3d_frame_count_skipped"] = skipped
    payload["word"] = qa_word
    payload["viewer_qa_alias"] = {
        "source_word": source_word,
        "purpose": "hand_lifting_tcn_v1_center_estimated_3d_word_viewer_qa",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def main() -> int:
    args = parse_args()
    sources = mirrored_sources(args.word_root, args.match_prefix, args.limit)
    if not sources:
        raise FileNotFoundError(f"No mirrored QA files found for prefix: {args.match_prefix}")
    if args.clean:
        for path in args.word_root.glob(f"{args.prefix}_*.json"):
            path.unlink()

    checkpoint, model = load_tcn_model(args)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    created: list[dict[str, Any]] = []
    skipped_existing: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for item in sources:
        source_word = item["source_word"]
        source_path = args.word_root / f"{source_word}.json"
        inference_path = Path(item["matched_file"]) if args.source_mode == "matched-copy" else source_path
        output_word = f"{args.prefix}_{item['index']:02d}_{source_word}"
        output_path = args.word_root / f"{output_word}.json"
        if args.skip_existing and output_path.exists():
            skipped_existing.append({"source_word": source_word, "output": str(output_path)})
            continue
        try:
            if not inference_path.exists():
                raise FileNotFoundError(inference_path)
            payload = build_estimated_word(load_json(inference_path), model, checkpoint, device, args, output_word, source_word)
            payload["viewer_qa_alias"]["inference_source_file"] = inference_path.name
            payload["viewer_qa_alias"]["source_mode"] = args.source_mode
            write_json(output_path, payload)
            created.append(
                {
                    "source_word": source_word,
                    "qa_word": output_word,
                    "inference_source": str(inference_path),
                    "output": str(output_path),
                    "processed": payload["sample"]["processing"]["estimated_3d_frame_count_processed"],
                    "skipped": payload["sample"]["processing"]["estimated_3d_frame_count_skipped"],
                }
            )
        except Exception as error:  # noqa: BLE001 - keep batch generation going and report failures.
            failed.append({"source_word": source_word, "output": str(output_path), "error": str(error)})

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "device": str(device),
        "word_root": str(args.word_root),
        "checkpoint": str(args.checkpoint),
        "prefix": args.prefix,
        "match_prefix": args.match_prefix,
        "source_mode": args.source_mode,
        "window_size": args.window_size,
        "center_index": args.center_index,
        "requested_count": len(sources),
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
    print(json.dumps({k: manifest[k] for k in ("device", "requested_count", "created_count", "failed_count")}, ensure_ascii=False, indent=2))
    if failed:
        print(json.dumps({"first_failed": failed[:5]}, ensure_ascii=False, indent=2))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
