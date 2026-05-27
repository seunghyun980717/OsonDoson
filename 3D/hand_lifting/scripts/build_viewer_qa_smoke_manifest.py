#!/usr/bin/env python3
"""Build a tiny viewer QA manifest for hand-lifting smoke review.

This script does not modify the viewer source or the default manifest. It
creates a separate manifest under the viewer public data root and copies only a
small number of existing F-view keypoint sequences for quick visual QA.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


DEFAULT_WORKSPACE_ROOT = Path("D:/ssafy/3_\uc790\uc728")
DEFAULT_REPO_ROOT = DEFAULT_WORKSPACE_ROOT / "S14P31E104"
DEFAULT_SPLIT_SUMMARY = DEFAULT_WORKSPACE_ROOT / "artifacts/hand_lifting/05_split/hand_lifting_split_mixed_summary.json"
DEFAULT_TRAINING_ROOT = DEFAULT_WORKSPACE_ROOT / "\uc218\uc5b4 \uc601\uc0c1/1.Training"
DEFAULT_VIEWER_DATA_ROOT = Path("D:/ssafy/3D_DATA/viewer-public-data")
DEFAULT_VIEWER_VIDEO_ROOT = Path("D:/ssafy/3D_DATA/viewer-public-videos")
DEFAULT_MANIFEST_NAME = "hand-lifting-v0-qa-manifest.json"
DEFAULT_QA_GROUP = "hand-lifting-v0-qa"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-summary", type=Path, default=DEFAULT_SPLIT_SUMMARY)
    parser.add_argument("--training-root", type=Path, default=DEFAULT_TRAINING_ROOT)
    parser.add_argument("--viewer-data-root", type=Path, default=DEFAULT_VIEWER_DATA_ROOT)
    parser.add_argument("--viewer-video-root", type=Path, default=DEFAULT_VIEWER_VIDEO_ROOT)
    parser.add_argument("--manifest-name", default=DEFAULT_MANIFEST_NAME)
    parser.add_argument("--qa-group", default=DEFAULT_QA_GROUP)
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--split", default="test")
    parser.add_argument("--category", default="WORD", choices=("WORD", "SEN"))
    parser.add_argument("--real", default="REAL01")
    parser.add_argument("--view", default="F")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fp:
        return json.load(fp)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def natural_key(value: str) -> list[Any]:
    parts: list[Any] = []
    current = ""
    is_digit = False
    for char in value:
        char_is_digit = char.isdigit()
        if current and char_is_digit != is_digit:
            parts.append(int(current) if is_digit else current.lower())
            current = ""
        current += char
        is_digit = char_is_digit
    if current:
        parts.append(int(current) if is_digit else current.lower())
    return parts


def source_keypoint_root(training_root: Path, category: str, real: str) -> Path:
    category_lower = category.lower()
    real_index = real.replace("REAL", "")
    return training_root / f"[\ub77c\ubca8]{real_index}_real_{category_lower}_keypoint" / "01"


def source_video_root(training_root: Path, category: str, real: str) -> Path:
    category_lower = category.lower()
    real_index = real.replace("REAL", "")
    return training_root / f"[\uc6d0\ucc9c]{real_index}_real_{category_lower}_video" / "01"


def select_sequences(args: argparse.Namespace) -> list[str]:
    split_summary = read_json(args.split_summary)
    sequence_split = split_summary.get("sequence_split", {})
    suffix = f"{args.real}_{args.view}"
    prefix = f"NIA_SL_{args.category}"
    selected = [
        sequence_key
        for sequence_key, split in sequence_split.items()
        if split == args.split
        and sequence_key.startswith(prefix)
        and sequence_key.endswith(suffix)
    ]
    selected.sort(key=natural_key)
    return selected[: args.count]


def copy_sequence_frames(
    source_dir: Path,
    destination_dir: Path,
    source_key: str,
    destination_key: str,
    overwrite: bool,
) -> list[str]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Missing source sequence directory: {source_dir}")
    frame_files = sorted(
        [path for path in source_dir.glob("*_keypoints.json") if path.is_file()],
        key=lambda path: natural_key(path.name),
    )
    if not frame_files:
        raise FileNotFoundError(f"No keypoint frames found: {source_dir}")
    first_frame = frame_files[0].name
    if "_000000000000_keypoints.json" not in first_frame:
        raise ValueError(f"Frame 0 must be present as the first frame, got: {first_frame}")

    if destination_dir.exists() and overwrite:
        shutil.rmtree(destination_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)

    copied_names: list[str] = []
    for source_path in frame_files:
        destination_name = source_path.name.replace(source_key, destination_key, 1)
        destination_path = destination_dir / destination_name
        if overwrite or not destination_path.exists():
            shutil.copy2(source_path, destination_path)
        copied_names.append(destination_name)
    return copied_names


def copy_video(source_path: Path, destination_path: Path, overwrite: bool) -> bool:
    if not source_path.exists():
        return False
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if overwrite or not destination_path.exists():
        shutil.copy2(source_path, destination_path)
    return True


def main() -> int:
    args = parse_args()
    sequence_keys = select_sequences(args)
    if len(sequence_keys) < args.count:
        raise RuntimeError(f"Only found {len(sequence_keys)} matching sequences; requested {args.count}.")

    source_keypoint_dir = source_keypoint_root(args.training_root, args.category, args.real)
    source_video_dir = source_video_root(args.training_root, args.category, args.real)
    output_frame_root = args.viewer_data_root / args.qa_group / "sequences"
    output_video_root = args.viewer_video_root / args.qa_group

    sequences = []
    for qa_index, source_key in enumerate(sequence_keys):
        qa_key = f"QA{qa_index}_{source_key}"
        frame_source_dir = source_keypoint_dir / source_key
        frame_destination_dir = output_frame_root / qa_key
        frame_files = copy_sequence_frames(frame_source_dir, frame_destination_dir, source_key, qa_key, args.overwrite)

        video_source_path = source_video_dir / f"{source_key}.mp4"
        video_destination_path = output_video_root / f"{qa_key}.mp4"
        has_video = copy_video(video_source_path, video_destination_path, args.overwrite)

        sequences.append(
            {
                "id": f"QA-{qa_index}",
                "label": f"{qa_index:02d} QA {args.category} {source_key}",
                "category": args.category,
                "qaIndex": qa_index,
                "sourceKey": source_key,
                "key": qa_key,
                "video": f"/videos/{args.qa_group}/{qa_key}.mp4" if has_video else None,
                "frameDir": f"/data/{args.qa_group}/sequences/{qa_key}",
                "files": frame_files,
            }
        )

    manifest = {
        "schemaVersion": "viewer-qa-manifest/v1",
        "description": "Hand lifting v0 viewer QA smoke manifest. QA-0 is intentionally first.",
        "selection": {
            "split": args.split,
            "category": args.category,
            "real": args.real,
            "view": args.view,
            "count": args.count,
            "mustIncludeQaIndex": 0,
        },
        "sequences": sequences,
    }
    manifest_path = args.viewer_data_root / args.manifest_name
    write_json(manifest_path, manifest)
    print(f"Manifest: {manifest_path}")
    print(f"Viewer URL: http://localhost:5173/?manifest=/data/{args.manifest_name}&sequence=QA-0")
    print("Sequences:")
    for sequence in sequences:
        print(f"  {sequence['id']} {sequence['sourceKey']} frames={len(sequence['files'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
