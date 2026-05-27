"""
동영상 파일 → (T, 134) keypoint 시퀀스

MediaPipe Holistic으로 각 프레임의 랜드마크를 추출한 뒤
mediapipe_converter.mediapipe_to_frame() 으로 (134,) 벡터로 변환.

사용:
    from data_utils.video_to_keypoints import video_to_keypoints
    seq = video_to_keypoints("path/to/video.mp4")   # (T, 134) or None
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np


def _lm_to_dict(lm) -> dict:
    """MediaPipe NormalizedLandmark 객체 → dict (mediapipe_to_frame 포맷)"""
    return {
        "x": lm.x,
        "y": lm.y,
        "z": lm.z,
        "visibility": getattr(lm, "visibility", 0.0),
    }


def video_to_keypoints(
    video_path: str | Path,
    *,
    model_complexity: int = 1,
    min_detection_confidence: float = 0.5,
    min_tracking_confidence:  float = 0.5,
    skip_empty: bool = True,
) -> Optional[np.ndarray]:
    """
    동영상 파일 → 어깨 기준 정규화된 (T, 134) float32.

    Args:
        video_path:                동영상 파일 경로 (.mp4 등)
        model_complexity:          MediaPipe 모델 복잡도 (0/1/2, 기본 1)
        min_detection_confidence:  초기 검출 임계값
        min_tracking_confidence:   추적 임계값
        skip_empty:                pose 미검출 프레임 건너뜀 (기본 True)

    Returns:
        (T, 134) float32  — normalize_sequence 적용 완료
        None              — 유효 프레임이 없을 경우
    """
    try:
        import cv2
    except ImportError as e:
        raise ImportError(f"pip install opencv-python  ({e})")

    # MediaPipe 버전별 import 분기
    # - 0.9.x / 0.10.x 초반: mp.solutions.holistic.Holistic
    # - 0.10.x 후반: solutions 패키지 자체 제거됨 → 하위 호환 버전 필요
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

    from core.data_utils.mediapipe_converter import mediapipe_to_frame
    from core.data_utils.keypoint_loader import normalize_sequence

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise FileNotFoundError(f"영상 열기 실패: {video_path}")

    frames: list[np.ndarray] = []

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

            mp_data = {
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
            }
            frames.append(mediapipe_to_frame(mp_data))

    cap.release()

    if not frames:
        return None

    seq = np.stack(frames, axis=0)          # (T, 134)
    return normalize_sequence(seq)          # 어깨 기준 정규화
