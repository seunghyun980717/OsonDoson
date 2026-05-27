"""
동영상 파일 → (T, 150) keypoint 시퀀스 (sign-v2)

MediaPipe Holistic으로 각 프레임의 랜드마크를 추출한 뒤
mediapipe_to_frame_v2()로 (150,) 벡터 변환 후 어깨 기준 정규화.

사용:
    from core.data_utils.video_to_keypoints import video_to_keypoints
    seq = video_to_keypoints("path/to/video.mp4")   # (T, 150) or None
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np


def _lm_to_dict(lm) -> dict:
    """MediaPipe NormalizedLandmark 객체 → dict"""
    return {
        "x": lm.x,
        "y": lm.y,
        "z": lm.z,
        "visibility": getattr(lm, "visibility", 0.0),
    }


def video_to_keypoints(
    video_path: str | Path,
    *,
    model_complexity: int = 0,
    min_detection_confidence: float = 0.5,
    min_tracking_confidence:  float = 0.5,
    skip_empty: bool = True,
) -> Optional[np.ndarray]:
    """
    동영상 파일 → 어깨 기준 정규화된 (T, 150) float32 (sign-v2).

    Args:
        video_path:                동영상 파일 경로 (.mp4 등)
        model_complexity:          MediaPipe 모델 복잡도 (0=빠름/1=기본/2=정확, 기본 0)
        min_detection_confidence:  초기 검출 임계값
        min_tracking_confidence:   추적 임계값
        skip_empty:                pose 미검출 프레임 건너뜀 (기본 True)

    Returns:
        (T, 150) float32  — frames_to_sequence_v2 정규화 적용 완료
        None              — 유효 프레임이 없을 경우
    """
    try:
        import cv2
    except ImportError as e:
        raise ImportError(f"pip install opencv-python  ({e})")

    try:
        import mediapipe as mp
        Holistic = mp.solutions.holistic.Holistic
    except AttributeError:
        try:
            import mediapipe.solutions.holistic as _h
            Holistic = _h.Holistic
        except ImportError:
            raise ImportError(
                "설치된 mediapipe 버전이 Holistic을 지원하지 않습니다.\n"
                "  pip install 'mediapipe==0.10.9'\n"
                "Holistic은 mediapipe 0.10.x 중반 이후 제거됐습니다."
            )

    from core.data_utils.mediapipe_converter import frames_to_sequence_v2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"영상 열기 실패: {video_path}")

    raw_frames: list[dict] = []

    with Holistic(
        static_image_mode=False,
        model_complexity=model_complexity,
        min_detection_confidence=min_detection_confidence,
        min_tracking_confidence=min_tracking_confidence,
    ) as holistic:
        while True:
            ret, bgr = cap.read()
            if not ret:
                break

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            results = holistic.process(rgb)

            if skip_empty and results.pose_landmarks is None:
                continue

            raw_frames.append({
                "poseLandmarks": (
                    [_lm_to_dict(lm) for lm in results.pose_landmarks.landmark]
                    if results.pose_landmarks else []
                ),
                "leftHandLandmarks": (
                    [_lm_to_dict(lm) for lm in results.left_hand_landmarks.landmark]
                    if results.left_hand_landmarks else []
                ),
                "rightHandLandmarks": (
                    [_lm_to_dict(lm) for lm in results.right_hand_landmarks.landmark]
                    if results.right_hand_landmarks else []
                ),
            })

    cap.release()

    if not raw_frames:
        return None

    return frames_to_sequence_v2(raw_frames)   # (T, 150)
