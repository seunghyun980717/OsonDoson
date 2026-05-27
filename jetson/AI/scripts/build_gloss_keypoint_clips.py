"""
Build gloss-level keypoint clip JSON files matched to the representative gloss
manifest from ``build_gloss_clips.py``.

Output format follows the malmoongchi-style landmarks payload:

{
  "gloss": "나무",
  "source_dataset": "aihub_real_word",
  "landmarks": [
    {"frame": 1, "predictions": [{"keypoints": [...], "hand_pos": []}]},
    ...
  ]
}
"""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import sys

LKS_DIR = Path(__file__).resolve().parents[1]
if str(LKS_DIR) not in sys.path:
    sys.path.insert(0, str(LKS_DIR))

from core.config import (  # noqa: E402
    GENERATED_WORD_KEYPOINT_CLIPS_DIR,
    GENERATED_WORD_KEYPOINT_DB_PATH,
    GLOSS_CANDIDATE_MANIFEST_PATH,
)
FPS = 30.0


def safe_json_name(gloss: str) -> str:
    invalid = '<>:"/\\|?*'
    name = "".join("_" if ch in invalid else ch for ch in gloss).strip().rstrip(".")
    return f"{name or 'gloss'}.json"


def load_manifest(path: Path = GLOSS_CANDIDATE_MANIFEST_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def derive_aihub_keypoint_zip(video_zip_path: Path) -> Path | None:
    candidate = Path(str(video_zip_path).replace("[원천]", "[라벨]").replace("video", "keypoint"))
    if candidate.exists():
        return candidate
    return None


def build_aihub_frame_index(keypoint_zip_path: Path) -> dict[str, list[str]]:
    frame_index: dict[str, list[str]] = defaultdict(list)
    with zipfile.ZipFile(keypoint_zip_path) as archive:
        for member in archive.namelist():
            if not member.endswith("_keypoints.json"):
                continue
            stem = Path(member).stem
            video_stem = stem.rsplit("_", 1)[0]
            frame_index[video_stem].append(member)
    for members in frame_index.values():
        members.sort()
    return frame_index


def ai_hub_person_to_prediction(person: dict[str, Any]) -> dict[str, Any]:
    keypoints: list[float] = []
    for field in (
        "pose_keypoints_2d",
        "face_keypoints_2d",
        "hand_left_keypoints_2d",
        "hand_right_keypoints_2d",
    ):
        values = person.get(field) or []
        keypoints.extend(values)
    return {
        "keypoints": keypoints,
        "hand_pos": [],
    }


def extract_aihub_landmarks(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    video_zip_path = Path(candidate["video_zip_path"])
    keypoint_zip_path = derive_aihub_keypoint_zip(video_zip_path)
    if keypoint_zip_path is None:
        return []

    video_stem = Path(str(candidate["video_name"])).stem
    frame_start = max(0, int(math.floor(float(candidate["start"]) * FPS)))
    frame_end = max(frame_start, int(math.ceil(float(candidate["end"]) * FPS)))

    frame_index = build_aihub_frame_index(keypoint_zip_path)
    members = frame_index.get(video_stem, [])
    if not members:
        return []

    landmarks: list[dict[str, Any]] = []
    with zipfile.ZipFile(keypoint_zip_path) as archive:
        for output_frame, member in enumerate(members[frame_start : frame_end + 1], start=1):
            payload = json.loads(archive.read(member).decode("utf-8-sig"))
            person = payload.get("people") or {}
            landmarks.append(
                {
                    "frame": output_frame,
                    "predictions": [ai_hub_person_to_prediction(person)] if person else [],
                }
            )
    return landmarks


def extract_malmoongchi_landmarks(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    corpus_zip_path = Path(candidate["video_zip_path"])
    label_member = str(candidate["label_member"])
    frame_start = max(1, int(math.floor(float(candidate["start"]) * FPS)) + 1)
    frame_end = max(frame_start, int(math.ceil(float(candidate["end"]) * FPS)) + 1)

    with zipfile.ZipFile(corpus_zip_path) as archive:
        payload = json.loads(archive.read(label_member).decode("utf-8-sig"))
    frames = payload.get("landmarks") or []
    sliced = [frame for frame in frames if frame_start <= int(frame.get("frame", 0) or 0) <= frame_end]
    if not sliced:
        return []

    normalized: list[dict[str, Any]] = []
    for output_frame, frame in enumerate(sliced, start=1):
        normalized.append(
            {
                "frame": output_frame,
                "predictions": frame.get("predictions") or [],
            }
        )
    return normalized


def extract_landmarks(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    dataset_kind = str(candidate["dataset_kind"])
    if dataset_kind.startswith("aihub"):
        return extract_aihub_landmarks(candidate)
    if dataset_kind == "malmoongchi":
        return extract_malmoongchi_landmarks(candidate)
    return []


def build_keypoint_clips(
    selected: dict[str, dict[str, Any]],
    output_dir: Path = GENERATED_WORD_KEYPOINT_CLIPS_DIR,
    output_db_path: Path = GENERATED_WORD_KEYPOINT_DB_PATH,
    limit: int | None = None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_db: dict[str, str] = {}
    report = {
        "attempted": 0,
        "written": 0,
        "skipped_existing": 0,
        "empty": [],
        "failed": [],
    }

    items = list(selected.items())
    if limit is not None:
        items = items[:limit]

    for gloss, candidate in items:
        report["attempted"] += 1
        output_name = safe_json_name(gloss)
        output_path = output_dir / output_name

        if output_path.exists():
            generated_db[gloss] = str(output_path)
            report["skipped_existing"] += 1
            continue

        try:
            landmarks = extract_landmarks(candidate)
            if not landmarks:
                report["empty"].append(gloss)
                continue
            payload = {
                "gloss": gloss,
                "source_dataset": candidate["dataset_kind"],
                "source_video_name": candidate["video_name"],
                "start": candidate["start"],
                "end": candidate["end"],
                "landmarks": landmarks,
            }
            with open(output_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            generated_db[gloss] = str(output_path)
            report["written"] += 1
        except Exception as exc:  # noqa: BLE001
            report["failed"].append({"gloss": gloss, "error": str(exc)[:1000]})

    with open(output_db_path, "w", encoding="utf-8") as handle:
        json.dump(generated_db, handle, ensure_ascii=False, indent=2)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    manifest = load_manifest()
    report = build_keypoint_clips(manifest["selected"], limit=args.limit)
    print(
        "[gloss_keypoint_clips] attempted={attempted} written={written} skipped_existing={skipped_existing} empty={empty} failed={failed}".format(
            attempted=report["attempted"],
            written=report["written"],
            skipped_existing=report["skipped_existing"],
            empty=len(report["empty"]),
            failed=len(report["failed"]),
        )
    )
    print(f"[gloss_keypoint_clips] output_dir={GENERATED_WORD_KEYPOINT_CLIPS_DIR}")
    print(f"[gloss_keypoint_clips] output_db={GENERATED_WORD_KEYPOINT_DB_PATH}")


if __name__ == "__main__":
    main()
