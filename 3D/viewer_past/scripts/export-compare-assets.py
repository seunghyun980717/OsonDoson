"""Export sentence reconstruction artifacts into 3D_test compare viewer assets."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np


FRAME_MAP = {
    "pose_2d": "pose_keypoints_2d",
    "pose_3d": "pose_keypoints_3d",
    "left_hand_2d": "hand_left_keypoints_2d",
    "left_hand_3d": "hand_left_keypoints_3d",
    "right_hand_2d": "hand_right_keypoints_2d",
    "right_hand_3d": "hand_right_keypoints_3d",
    "face_2d": "face_keypoints_2d",
    "face_3d": "face_keypoints_3d",
}


def parse_args() -> argparse.Namespace:
    script_path = Path(__file__).resolve()
    workspace_root = script_path.parents[2]
    app_root = script_path.parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sentence-id", required=True)
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=workspace_root / "artifacts" / "sentence_reconstruction",
    )
    parser.add_argument(
        "--public-data-root",
        type=Path,
        default=app_root / "public" / "data",
    )
    parser.add_argument("--fps", type=int, default=20)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_npz(path: Path) -> dict[str, np.ndarray]:
    with np.load(path, allow_pickle=False) as data:
        return {key: np.asarray(data[key]) for key in data.files}


def frame_payload_from_arrays(arrays: dict[str, np.ndarray], frame_index: int) -> dict[str, Any]:
    people = {"person_id": -1}
    for key, target in FRAME_MAP.items():
        people[target] = arrays[key][frame_index].reshape(-1).astype(float).tolist()
    return {
        "version": 1.3,
        "people": people,
        "camparam": {},
    }


def write_sequence_frames(sequence_dir: Path, key: str, arrays: dict[str, np.ndarray]) -> list[str]:
    if sequence_dir.exists():
        shutil.rmtree(sequence_dir)
    sequence_dir.mkdir(parents=True, exist_ok=True)

    files: list[str] = []
    frame_count = next(iter(arrays.values())).shape[0]
    for index in range(frame_count):
        file_name = f"{key}_{index:012d}_keypoints.json"
        payload = frame_payload_from_arrays(arrays, index)
        (sequence_dir / file_name).write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        files.append(file_name)
    return files


def upsert_by_id(items: list[dict[str, Any]], entry: dict[str, Any]) -> list[dict[str, Any]]:
    filtered = [item for item in items if item.get("id") != entry.get("id")]
    filtered.append(entry)
    return filtered


def main() -> int:
    args = parse_args()
    sentence_dir = args.artifact_root / args.sentence_id
    if not sentence_dir.exists():
        raise FileNotFoundError(f"Artifact directory not found: {sentence_dir}")

    report = load_json(sentence_dir / "report.json")
    original_arrays = load_npz(sentence_dir / "original_sentence.npz")
    composed_arrays = load_npz(sentence_dir / "composed_sentence.npz")

    compare_root = args.public_data_root / "compare" / args.sentence_id
    original_key = f"CMP_{args.sentence_id}_ORIGINAL"
    composed_key = f"CMP_{args.sentence_id}_COMPOSED"
    original_id = f"CMP-{args.sentence_id}-ORIGINAL"
    composed_id = f"CMP-{args.sentence_id}-COMPOSED"

    original_files = write_sequence_frames(compare_root / original_key, original_key, original_arrays)
    composed_files = write_sequence_frames(compare_root / composed_key, composed_key, composed_arrays)

    report_target = compare_root / "report.json"
    report_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(sentence_dir / "report.json", report_target)

    compare_manifest_path = args.public_data_root / "compare-manifest.json"
    if compare_manifest_path.exists():
        compare_manifest = load_json(compare_manifest_path)
    else:
        compare_manifest = {"sequences": [], "pairs": []}

    original_entry = {
        "id": original_id,
        "label": f"Original {args.sentence_id}",
        "category": "CMP",
        "key": original_key,
        "video": "",
        "frameDir": f"/data/compare/{args.sentence_id}/{original_key}",
        "files": original_files,
        "fps": args.fps,
        "meta": {
            "role": "original",
            "sentenceId": args.sentence_id,
        },
    }
    composed_entry = {
        "id": composed_id,
        "label": f"Interpolated {args.sentence_id}",
        "category": "CMP",
        "key": composed_key,
        "video": "",
        "frameDir": f"/data/compare/{args.sentence_id}/{composed_key}",
        "files": composed_files,
        "fps": args.fps,
        "meta": {
            "role": "interpolated",
            "sentenceId": args.sentence_id,
        },
    }
    pair_entry = {
        "id": args.sentence_id,
        "label": args.sentence_id,
        "leftSequenceId": original_id,
        "rightSequenceId": composed_id,
        "report": f"/data/compare/{args.sentence_id}/report.json",
        "metrics": report.get("metrics", {}),
        "labels": report.get("labels", []),
        "word_ids": report.get("word_ids", []),
    }

    compare_manifest["sequences"] = upsert_by_id(compare_manifest.get("sequences", []), original_entry)
    compare_manifest["sequences"] = upsert_by_id(compare_manifest.get("sequences", []), composed_entry)
    compare_manifest["pairs"] = upsert_by_id(compare_manifest.get("pairs", []), pair_entry)
    compare_manifest_path.write_text(
        json.dumps(compare_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps({
        "sentence_id": args.sentence_id,
        "compare_manifest": str(compare_manifest_path),
        "left_sequence_id": original_id,
        "right_sequence_id": composed_id,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
