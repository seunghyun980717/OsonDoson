#!/usr/bin/env python3
"""Build one keypoint JSON per raw_out word folder.

Folders that already contain ``keypoints/*.json`` are merged frame-by-frame.
Folders without ``keypoints`` are treated as sentence JSON folders: the folder
name is matched against ``sign_script`` gloss segments, then the corresponding
``landmarks`` frames are extracted with a configurable time padding.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_INPUT_ROOT = Path("/Users/suwon/SSAFY/2학기/자율/raw_out")
DEFAULT_OUTPUT_NAME = "word_keypoints_merged"
FRAME_RE = re.compile(r"_(\d+)_keypoints\.json$", re.IGNORECASE)
IMAGE_WIDTH = 1920
IMAGE_HEIGHT = 1080
DEFAULT_FPS = 30
DEFAULT_PADDING_SEC = 0.5

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
COCO_FACE_COUNT = 68
COCO_LEFT_HAND_START = 91
COCO_RIGHT_HAND_START = 112
COCO_HAND_COUNT = 21


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--indent", type=int, default=2)
    parser.add_argument("--padding-sec", type=float, default=DEFAULT_PADDING_SEC)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


def sanitize_file_name(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "_", value.strip())
    return cleaned or "unknown"


def normalized_text(value: Any) -> str:
    return unicodedata.normalize("NFC", str(value if value is not None else "").strip())


def frame_number(path: Path) -> int:
    match = FRAME_RE.search(path.name)
    if match:
        return int(match.group(1))
    return 0


def sequence_id_from_frame_name(path: Path) -> str:
    return FRAME_RE.sub("", path.name)


def word_folders(input_root: Path) -> list[Path]:
    return sorted(
        [
            path
            for path in input_root.iterdir()
            if path.is_dir() and path.name not in {DEFAULT_OUTPUT_NAME, "3d_estimated_v0"}
        ],
        key=lambda path: path.name,
    )


def keypoint_folders(input_root: Path) -> list[Path]:
    return [path for path in word_folders(input_root) if (path / "keypoints").is_dir()]


def sentence_folders(input_root: Path) -> list[Path]:
    folders = []
    for path in word_folders(input_root):
        if (path / "keypoints").is_dir():
            continue
        for json_path in path.glob("*.json"):
            try:
                payload = read_json(json_path)
            except Exception:
                continue
            if isinstance(payload.get("landmarks"), list):
                folders.append(path)
                break
    return folders


def merge_folder(word_dir: Path) -> dict[str, Any]:
    keypoint_dir = word_dir / "keypoints"
    frame_paths = sorted(keypoint_dir.glob("*_keypoints.json"), key=lambda path: (frame_number(path), path.name))
    if not frame_paths:
        raise FileNotFoundError(f"No keypoint frames found: {keypoint_dir}")

    sequence_id = sequence_id_from_frame_name(frame_paths[0])
    frames: list[dict[str, Any]] = []
    for output_index, frame_path in enumerate(frame_paths):
        payload = read_json(frame_path)
        frames.append(
            {
                "frame_index": output_index,
                "source_frame_number": frame_number(frame_path),
                "source_file": frame_path.name,
                "version": payload.get("version"),
                "people": payload.get("people"),
                "camparam": payload.get("camparam"),
            }
        )

    return {
        "schema_version": "raw-out-merged-keypoints/v1",
        "word": word_dir.name,
        "source": {
            "source_dir": str(word_dir),
            "keypoint_dir": str(keypoint_dir),
            "sequence_id": sequence_id,
            "kind": "per_frame_keypoints",
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "frame_count": len(frames),
        "frames": frames,
    }


def finite_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result and result not in {float("inf"), float("-inf")} else default


def flat_to_points(values: Any, stride: int) -> list[list[float]]:
    if not isinstance(values, list):
        return []
    return [
        [finite_float(values[index + offset]) for offset in range(stride)]
        for index in range(0, len(values) - stride + 1, stride)
    ]


def flatten_part(points: list[list[float]]) -> list[float]:
    return [finite_float(value) for point in points for value in point]


def point_or_zero(points: list[list[float]], index: int | None) -> list[float]:
    if index is None or index >= len(points):
        return [0.0, 0.0, 0.0]
    point = points[index]
    return [
        finite_float(point[0] if len(point) > 0 else 0.0),
        finite_float(point[1] if len(point) > 1 else 0.0),
        finite_float(point[2] if len(point) > 2 else 0.0),
    ]


def average_visible(points: list[list[float]]) -> list[float]:
    visible = [point for point in points if len(point) >= 3 and finite_float(point[2]) > 0]
    if not visible:
        return [0.0, 0.0, 0.0]
    return [sum(point[axis] for point in visible) / len(visible) for axis in range(3)]


def convert_coco_wholebody_to_people(flat_keypoints: Any) -> dict[str, Any]:
    coco = flat_to_points(flat_keypoints, 3)
    if len(coco) < COCO_RIGHT_HAND_START + COCO_HAND_COUNT:
        raise ValueError(f"Expected at least 133 COCO WholeBody points, received {len(coco)}")

    pose = [point_or_zero(coco, coco_index) for coco_index in BODY25_TO_COCO]
    pose[1] = average_visible([coco[COCO_BODY["left_shoulder"]], coco[COCO_BODY["right_shoulder"]]])
    pose[8] = average_visible([coco[COCO_BODY["left_hip"]], coco[COCO_BODY["right_hip"]]])
    face = [point_or_zero(coco, index) for index in range(COCO_FACE_START, COCO_FACE_START + COCO_FACE_COUNT)]
    left_hand = [
        point_or_zero(coco, index)
        for index in range(COCO_LEFT_HAND_START, COCO_LEFT_HAND_START + COCO_HAND_COUNT)
    ]
    right_hand = [
        point_or_zero(coco, index)
        for index in range(COCO_RIGHT_HAND_START, COCO_RIGHT_HAND_START + COCO_HAND_COUNT)
    ]

    return {
        "person_id": -1,
        "pose_keypoints_2d": flatten_part(pose),
        "face_keypoints_2d": flatten_part(face),
        "hand_left_keypoints_2d": flatten_part(left_hand),
        "hand_right_keypoints_2d": flatten_part(right_hand),
    }


def sentence_json_path(word_dir: Path) -> Path:
    for path in sorted(word_dir.glob("*.json")):
        try:
            payload = read_json(path)
        except Exception:
            continue
        if isinstance(payload.get("landmarks"), list):
            return path
    raise FileNotFoundError(f"No sentence landmarks JSON found: {word_dir}")


def sign_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    sign_script = payload.get("sign_script") if isinstance(payload.get("sign_script"), dict) else {}
    strong = sign_script.get("sign_gestures_strong")
    weak = sign_script.get("sign_gestures_weak")
    segments: list[dict[str, Any]] = []
    if isinstance(strong, list):
        segments.extend({**segment, "_source": "sign_gestures_strong"} for segment in strong if isinstance(segment, dict))
    if isinstance(weak, list):
        segments.extend({**segment, "_source": "sign_gestures_weak"} for segment in weak if isinstance(segment, dict))
    return segments


def find_word_segment(payload: dict[str, Any], word: str) -> dict[str, Any]:
    normalized_word = normalized_text(word)
    matches = [
        segment
        for segment in sign_segments(payload)
        if normalized_text(segment.get("gloss_id", "")) == normalized_word
    ]
    if not matches:
        raise ValueError(f"No sign_script segment found for word: {word}")
    matches.sort(key=lambda segment: (0 if segment.get("_source") == "sign_gestures_strong" else 1, finite_float(segment.get("start"))))
    return matches[0]


def fps_for_payload(payload: dict[str, Any]) -> float:
    fps = finite_float((payload.get("potogrf") or {}).get("fps"), 0.0)
    if fps > 0:
        return fps
    duration = finite_float((payload.get("metaData") or {}).get("duration"), 0.0)
    landmarks = payload.get("landmarks")
    if duration > 0 and isinstance(landmarks, list) and landmarks:
        return len(landmarks) / duration
    return DEFAULT_FPS


def extract_sentence_word(word_dir: Path, padding_sec: float) -> dict[str, Any]:
    source_path = sentence_json_path(word_dir)
    payload = read_json(source_path)
    landmarks = payload.get("landmarks")
    if not isinstance(landmarks, list) or not landmarks:
        raise ValueError(f"No landmarks frames found: {source_path}")

    segment = find_word_segment(payload, word_dir.name)
    fps = fps_for_payload(payload)
    source_start_sec = finite_float(segment.get("start"))
    source_end_sec = finite_float(segment.get("end"), source_start_sec)
    padded_start_sec = max(0.0, source_start_sec - padding_sec)
    padded_end_sec = max(padded_start_sec, source_end_sec + padding_sec)
    start_index = max(0, int(padded_start_sec * fps))
    end_index = min(len(landmarks), max(start_index + 1, int(padded_end_sec * fps + 0.999999)))
    selected = landmarks[start_index:end_index]

    frames: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for output_index, frame in enumerate(selected):
        predictions = frame.get("predictions") if isinstance(frame, dict) else None
        prediction = predictions[0] if isinstance(predictions, list) and predictions else {}
        try:
            people = convert_coco_wholebody_to_people(prediction.get("keypoints"))
        except Exception as error:  # noqa: BLE001
            people = None
            errors.append({"frame_index": output_index, "source_frame": frame.get("frame"), "error": str(error)})
        frames.append(
            {
                "frame_index": output_index,
                "source_frame_number": int(finite_float(frame.get("frame"), start_index + output_index + 1)),
                "source_landmark_index": start_index + output_index,
                "people": people,
            }
        )

    sequence_id = str(payload.get("id") or payload.get("vido_file_nm") or source_path.stem)
    return {
        "schema_version": "raw-out-merged-keypoints/v1",
        "word": word_dir.name,
        "source": {
            "source_dir": str(word_dir),
            "sentence_json": str(source_path),
            "sequence_id": sequence_id,
            "kind": "sentence_landmarks_segment",
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "segment": {
            "gloss_id": segment.get("gloss_id"),
            "segment_source": segment.get("_source"),
            "source_start_sec": source_start_sec,
            "source_end_sec": source_end_sec,
            "padding_sec": padding_sec,
            "padded_start_sec": padded_start_sec,
            "padded_end_sec": padded_end_sec,
            "fps": fps,
            "source_start_frame_index": start_index,
            "source_end_frame_index_exclusive": end_index,
        },
        "frame_count": len(frames),
        "frames": frames,
        "errors": errors,
    }


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

    created = []
    failed = []
    for word_dir in keypoint_folders(input_root):
        payload = merge_folder(word_dir)
        output_path = output_root / f"{sanitize_file_name(word_dir.name)}.json"
        write_json(output_path, payload, args.indent)
        created.append(
            {
                "word": word_dir.name,
                "output": str(output_path),
                "frame_count": payload["frame_count"],
                "first_frame": payload["frames"][0]["source_frame_number"],
                "last_frame": payload["frames"][-1]["source_frame_number"],
                "source_kind": payload["source"]["kind"],
            }
        )
    for word_dir in sentence_folders(input_root):
        try:
            payload = extract_sentence_word(word_dir, args.padding_sec)
            output_path = output_root / f"{sanitize_file_name(word_dir.name)}.json"
            write_json(output_path, payload, args.indent)
            created.append(
                {
                    "word": word_dir.name,
                    "output": str(output_path),
                    "frame_count": payload["frame_count"],
                    "first_frame": payload["frames"][0]["source_frame_number"],
                    "last_frame": payload["frames"][-1]["source_frame_number"],
                    "source_kind": payload["source"]["kind"],
                    "segment": payload["segment"],
                    "error_count": len(payload["errors"]),
                }
            )
        except Exception as error:  # noqa: BLE001
            failed.append({"word": word_dir.name, "source_dir": str(word_dir), "error": str(error)})

    manifest = {
        "schema_version": "raw-out-merged-keypoints-manifest/v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_root": str(input_root),
        "output_root": str(output_root),
        "word_count": len(created),
        "frame_count": sum(item["frame_count"] for item in created),
        "failed_count": len(failed),
        "created": created,
        "failed": failed,
    }
    write_json(output_root / "_manifest.json", manifest, args.indent)
    print(
        json.dumps(
            {
                "word_count": manifest["word_count"],
                "frame_count": manifest["frame_count"],
                "failed_count": manifest["failed_count"],
            },
            ensure_ascii=False,
        )
    )
    print(f"Wrote {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
