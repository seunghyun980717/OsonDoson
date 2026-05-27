"""
MediaPipe Holistic → (134,) keypoint 변환

동료(Spring Boot converter)의 MediaPipe2OpenPoseConverter.java 로직 Python 이식.
목적: MediaPipe 랜드마크 → SignLSTM이 기대하는 (T, 134) float32 입력 변환.

두 가지 진입점
──────────────
1. mediapipe_to_frame(mp_data) → (134,)
   프론트엔드 → Java converter 없이 Python FastAPI에서 직접 처리할 때 사용.
   MediaPipe normalized [0,1] 좌표를 픽셀 변환 없이 그대로 사용
   (normalize_sequence가 어깨 기준 상대좌표로 재정규화하므로 절대 스케일 무관).

2. parse_frame_converter(openpose_json) → (134,)
   Java converter → FastAPI 로 전달되는 OpenPose JSON 1프레임 파싱.
   AIHUB 포맷과 차이:
     • AIHUB:     people = dict   {"pose_keypoints_2d": [...]}
     • converter: people = array  [{"pose_keypoints_2d": [...]}]
   키 이름은 @JsonProperty 덕분에 동일하게 snake_case.

참고 파일
─────────
  dashbord/converter/.../MediaPipe2OpenPoseConverter.java
  dashbord/converter/.../KeypointMappingConstants.java
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from app.ai_runtime.core.config import IMG_W, IMG_H


# ── MediaPipe 33pt → OpenPose 25pt 매핑 ──────────────────────────────────────
# Java KeypointMappingConstants.POSE_MAP 과 1:1 대응.
# 항목 형식: (is_calc, mp_index, calc_a, calc_b)
#   is_calc=False → pose_lms[mp_index] 직접 사용
#   is_calc=True  → (pose_lms[calc_a] + pose_lms[calc_b]) / 2 (중간점)
_POSE_MAP: list[tuple[bool, int, int, int]] = [
    (False,  0, -1, -1),   #  0: Nose
    (True,  -1, 11, 12),   #  1: Neck       ← (LShoulder+RShoulder)/2
    (False, 12, -1, -1),   #  2: RShoulder  ← normalize_sequence idx 2
    (False, 14, -1, -1),   #  3: RElbow
    (False, 16, -1, -1),   #  4: RWrist
    (False, 11, -1, -1),   #  5: LShoulder  ← normalize_sequence idx 5
    (False, 13, -1, -1),   #  6: LElbow
    (False, 15, -1, -1),   #  7: LWrist
    (True,  -1, 23, 24),   #  8: MidHip     ← (LHip+RHip)/2
    (False, 24, -1, -1),   #  9: RHip
    (False, 26, -1, -1),   # 10: RKnee
    (False, 28, -1, -1),   # 11: RAnkle
    (False, 23, -1, -1),   # 12: LHip
    (False, 25, -1, -1),   # 13: LKnee
    (False, 27, -1, -1),   # 14: LAnkle
    (False,  5, -1, -1),   # 15: REye
    (False,  2, -1, -1),   # 16: LEye
    (False,  8, -1, -1),   # 17: REar
    (False,  7, -1, -1),   # 18: LEar
    (False, 31, -1, -1),   # 19: LBigToe
    (False, 17, -1, -1),   # 20: LSmallToe (근사값: MP index 17)
    (False, 29, -1, -1),   # 21: LHeel
    (False, 32, -1, -1),   # 22: RBigToe
    (False, 18, -1, -1),   # 23: RSmallToe (근사값: MP index 18)
    (False, 30, -1, -1),   # 24: RHeel
]


def _mirror_x(normalized_x: float) -> float:
    """
    카메라 기준 X → 사람 기준 X (좌우 반전).
    Java: mirrorX(normalizedX, W) = (1.0 - normalizedX) * W
    여기서는 normalized 좌표 공간에서 반전만 적용 (픽셀 변환 생략).
    """
    return 1.0 - normalized_x


# ── 진입점 1: MediaPipe 원본 → (134,) ─────────────────────────────────────────

def mediapipe_to_frame(mp_data: dict) -> np.ndarray:
    """
    MediaPipe Holistic 원본 JSON 1프레임 → (134,) float32.

    Java converter를 거치지 않고 Python에서 직접 처리할 때 사용.
    MediaPipe 좌표는 이미 normalized [0,1] → 픽셀 변환 없이 그대로 사용.
    normalize_sequence()가 어깨 기준 상대좌표로 재정규화하므로 절대 스케일 무관.

    Args:
        mp_data: {
            "poseLandmarks":      [{"x":…,"y":…,"z":…,"visibility":…}, …]  # 33개
            "leftHandLandmarks":  [{"x":…,"y":…,"z":…,"visibility":…}, …]  # 21개 or null
            "rightHandLandmarks": [{"x":…,"y":…,"z":…,"visibility":…}, …]  # 21개 or null
            "videoWidth":  int   (이 함수에서는 미사용)
            "videoHeight": int   (이 함수에서는 미사용)
        }

    Returns:
        (134,) float32  — normalize_sequence() 적용 전 원본 좌표
    """
    pose_lms  = mp_data.get("poseLandmarks")      or []
    lhand_lms = mp_data.get("leftHandLandmarks")  or []
    rhand_lms = mp_data.get("rightHandLandmarks") or []

    # ── Pose 25pt (33→25 매핑 + X 반전) ────────────────────────────────────
    pose_xy = np.zeros((25, 2), dtype=np.float32)
    if pose_lms:
        for op_idx, (is_calc, mp_idx, calc_a, calc_b) in enumerate(_POSE_MAP):
            if is_calc:
                a = pose_lms[calc_a]
                b = pose_lms[calc_b]
                x = _mirror_x((a["x"] + b["x"]) / 2.0)
                y = (a["y"] + b["y"]) / 2.0
            else:
                lm = pose_lms[mp_idx]
                x  = _mirror_x(lm["x"])
                y  = lm["y"]
            pose_xy[op_idx] = [x, y]

    # ── Hand 21pt (X 반전만 적용) ───────────────────────────────────────────
    def _hand_xy(lms: list) -> np.ndarray:
        arr = np.zeros((21, 2), dtype=np.float32)
        for i, lm in enumerate(lms[:21]):
            arr[i] = [_mirror_x(lm["x"]), lm["y"]]
        return arr

    lhand_xy = _hand_xy(lhand_lms)
    rhand_xy = _hand_xy(rhand_lms)

    feat = np.concatenate([pose_xy, lhand_xy, rhand_xy], axis=0)  # (67, 2)
    return feat.flatten().astype(np.float32)                        # (134,)


# ── 진입점 2: converter OpenPose JSON → (134,) ─────────────────────────────────

def parse_frame_converter(openpose_json: dict) -> np.ndarray:
    """
    Java converter → FastAPI 로 전달되는 OpenPose JSON 1프레임 → (134,) float32.

    converter 포맷 특이사항:
      • people 이 list  → people[0] 에서 단일 인물 데이터 추출
      • 픽셀 좌표 (converter의 실제 videoW×H 기준)
      • 키 이름은 snake_case (@JsonProperty 덕분에 AIHUB와 동일)

    픽셀→정규화 시 IMG_W/IMG_H(1920×1080)로 나눔.
    converter 영상 해상도가 다를 수 있으나 normalize_sequence()가
    어깨 너비 기준으로 재정규화하므로 절대 스케일 차이는 무관.

    Args:
        openpose_json: {
            "version": 1.3,
            "people": [{
                "pose_keypoints_2d":       [x,y,c × 25 = 75 floats (pixel)],
                "hand_left_keypoints_2d":  [x,y,c × 21 = 63 floats (pixel)],
                "hand_right_keypoints_2d": [x,y,c × 21 = 63 floats (pixel)],
                ...
            }]
        }

    Returns:
        (134,) float32
    """
    people = openpose_json.get("people") or []
    if not people:
        return np.zeros(134, dtype=np.float32)

    p = people[0]  # converter는 단일 인물 [0] 고정

    def _extract_xy(flat: list, n: int) -> np.ndarray:
        """flat [x,y,c, x,y,c, …] → (n, 2) — confidence 제외"""
        if not flat:
            return np.zeros((n, 2), dtype=np.float32)
        arr = np.array(flat, dtype=np.float32).reshape(n, 3)
        return arr[:, :2]

    pose  = _extract_xy(p.get("pose_keypoints_2d",       []), 25)  # (25,2) pixel
    lhand = _extract_xy(p.get("hand_left_keypoints_2d",  []), 21)  # (21,2) pixel
    rhand = _extract_xy(p.get("hand_right_keypoints_2d", []), 21)  # (21,2) pixel

    feat = np.concatenate([pose, lhand, rhand], axis=0)  # (67, 2) pixel

    # pixel → normalized [0,1]  (IMG_W=1920, IMG_H=1080)
    feat[:, 0] /= IMG_W
    feat[:, 1] /= IMG_H

    return feat.flatten().astype(np.float32)  # (134,)


# ── 시퀀스 변환 헬퍼 ───────────────────────────────────────────────────────────

def mediapipe_frames_to_sequence(frames: list[dict]) -> np.ndarray:
    """
    MediaPipe 프레임 리스트 → (T, 134) float32.
    각 프레임은 mediapipe_to_frame() 형식의 dict.

    Args:
        frames: [mp_data_frame0, mp_data_frame1, …]

    Returns:
        (T, 134) float32  — normalize_sequence() 적용 전
    """
    arr = [mediapipe_to_frame(f) for f in frames]
    return np.stack(arr, axis=0)


def converter_frames_to_sequence(frames: list[dict]) -> np.ndarray:
    """
    Java converter OpenPose 프레임 리스트 → (T, 134) float32.
    각 프레임은 parse_frame_converter() 형식의 dict (people array).

    Args:
        frames: [openpose_frame0, openpose_frame1, …]

    Returns:
        (T, 134) float32  — normalize_sequence() 적용 전
    """
    arr = [parse_frame_converter(f) for f in frames]
    return np.stack(arr, axis=0)
