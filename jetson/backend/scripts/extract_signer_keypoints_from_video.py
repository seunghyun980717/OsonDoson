from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DEFAULT_OUT_DIR = BACKEND_DIR / "docs"


def lm_to_dict(lm) -> dict[str, float]:
    return {
        "x": float(lm.x),
        "y": float(lm.y),
        "z": float(lm.z),
        "visibility": float(getattr(lm, "visibility", 0.0)),
    }


def empty_landmarks(count: int) -> list[dict[str, float]]:
    return [{"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0} for _ in range(count)]


def extract_frames(video_path: Path) -> tuple[list[dict], int, int]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"failed to open video: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    frames: list[dict] = []

    with mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose, mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        while True:
            ret, bgr = cap.read()
            if not ret:
                break

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            pose_results = pose.process(rgb)
            hands_results = hands.process(rgb)
            if pose_results.pose_landmarks is None:
                continue

            left = empty_landmarks(21)
            right = empty_landmarks(21)
            if hands_results.multi_hand_landmarks and hands_results.multi_handedness:
                for hand_landmarks, handedness in zip(
                    hands_results.multi_hand_landmarks,
                    hands_results.multi_handedness,
                ):
                    label = handedness.classification[0].label.lower()
                    points = [lm_to_dict(lm) for lm in hand_landmarks.landmark]
                    # MediaPipe Hands label is from viewer perspective, so swap to signer body-side.
                    if label == "left":
                        right = points
                    elif label == "right":
                        left = points

            frames.append(
                {
                    "poseLandmarks": [lm_to_dict(lm) for lm in pose_results.pose_landmarks.landmark],
                    "leftHandLandmarks": left,
                    "rightHandLandmarks": right,
                    "videoWidth": width,
                    "videoHeight": height,
                }
            )

    cap.release()
    return frames, width, height


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    video_path = args.video.resolve()
    out_dir = args.out_dir.resolve()
    pretty_out = out_dir / f"{video_path.stem}.json"
    min_out = out_dir / f"{video_path.stem}.min.json"

    frames, _, _ = extract_frames(args.video)
    payload = {"type": "signer_keypoints", "frames": frames}

    out_dir.mkdir(parents=True, exist_ok=True)
    pretty_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    min_out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    print(f"video={video_path}")
    print(f"frames={len(frames)}")
    print(f"pretty_out={pretty_out}")
    print(f"min_out={min_out}")


if __name__ == "__main__":
    main()
