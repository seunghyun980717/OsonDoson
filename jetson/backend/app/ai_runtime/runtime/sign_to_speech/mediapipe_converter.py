"""
MediaPipe Holistic → (134,) or (150,) keypoint 변환

목적: MediaPipe 랜드마크 → Sign 모델이 기대하는 벡터로 변환.
- v1 (Legacy): (T, 134) - OpenPose 25pt 스타일 매핑
- v2 (Current): (T, 150) - MediaPipe 33pt 원본 기반 정규화
"""
from __future__ import annotations

import numpy as np

from app.ai_runtime.core.config import IMG_W, IMG_H


# ── MediaPipe 33pt → OpenPose 25pt 매핑 (Legacy v1 용) ────────────────────────
_POSE_MAP: list[tuple[bool, int, int, int]] = [
    (False,  0, -1, -1),   #  0: Nose
    (True,  -1, 11, 12),   #  1: Neck
    (False, 12, -1, -1),   #  2: RShoulder
    (False, 14, -1, -1),   #  3: RElbow
    (False, 16, -1, -1),   #  4: RWrist
    (False, 11, -1, -1),   #  5: LShoulder
    (False, 13, -1, -1),   #  6: LElbow
    (False, 15, -1, -1),   #  7: LWrist
    (True,  -1, 23, 24),   #  8: MidHip
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
    (False, 17, -1, -1),   # 20: LSmallToe
    (False, 29, -1, -1),   # 21: LHeel
    (False, 32, -1, -1),   # 22: RBigToe
    (False, 18, -1, -1),   # 23: RSmallToe
    (False, 30, -1, -1),   # 24: RHeel
]


def _mirror_x(normalized_x: float) -> float:
    return 1.0 - normalized_x


# ── v1 Legacy 변환 로직 (134차원) ──────────────────────────────────────────────

def mediapipe_to_frame(mp_data: dict, mirror_x: bool = True) -> np.ndarray:
    pose_lms  = mp_data.get("poseLandmarks")      or []
    lhand_lms = mp_data.get("leftHandLandmarks")  or []
    rhand_lms = mp_data.get("rightHandLandmarks") or []

    def _mx(x: float) -> float:
        return _mirror_x(x) if mirror_x else x

    pose_xy = np.zeros((25, 2), dtype=np.float32)
    if pose_lms:
        for op_idx, (is_calc, mp_idx, calc_a, calc_b) in enumerate(_POSE_MAP):
            if is_calc:
                a = pose_lms[calc_a]
                b = pose_lms[calc_b]
                x = _mx((a["x"] + b["x"]) / 2.0)
                y = (a["y"] + b["y"]) / 2.0
            else:
                lm = pose_lms[mp_idx]
                x  = _mx(lm["x"])
                y  = lm["y"]
            pose_xy[op_idx] = [x, y]

    def _hand_xy(lms: list) -> np.ndarray:
        arr = np.zeros((21, 2), dtype=np.float32)
        for i, lm in enumerate(lms[:21]):
            arr[i] = [_mx(lm["x"]), lm["y"]]
        return arr

    lhand_xy = _hand_xy(lhand_lms)
    rhand_xy = _hand_xy(rhand_lms)

    feat = np.concatenate([pose_xy, lhand_xy, rhand_xy], axis=0)
    return feat.flatten().astype(np.float32)


def parse_frame_converter(openpose_json: dict) -> np.ndarray:
    people = openpose_json.get("people") or []
    if not people:
        return np.zeros(134, dtype=np.float32)

    p = people[0]

    def _extract_xy(flat: list, n: int) -> np.ndarray:
        if not flat:
            return np.zeros((n, 2), dtype=np.float32)
        arr = np.array(flat, dtype=np.float32).reshape(n, 3)
        return arr[:, :2]

    pose  = _extract_xy(p.get("pose_keypoints_2d",       []), 25)
    lhand = _extract_xy(p.get("hand_left_keypoints_2d",  []), 21)
    rhand = _extract_xy(p.get("hand_right_keypoints_2d", []), 21)

    feat = np.concatenate([pose, lhand, rhand], axis=0)
    feat[:, 0] /= IMG_W
    feat[:, 1] /= IMG_H

    return feat.flatten().astype(np.float32)


# ── v2 최신 변환 로직 (150차원) ────────────────────────────────────────────────

def mediapipe_to_frame_v2(mp_data: dict) -> np.ndarray:
    """MediaPipe 33pt pose + 21pt hands 그대로 사용 (150차원)"""
    def _lm_xy(lms, n: int) -> np.ndarray:
        arr = np.zeros((n, 2), dtype=np.float32)
        if lms:
            for i, lm in enumerate(lms[:n]):
                arr[i] = [lm.get("x", 0.0), lm.get("y", 0.0)]
        return arr

    pose  = _lm_xy(mp_data.get("poseLandmarks"),     33)
    lhand = _lm_xy(mp_data.get("leftHandLandmarks"),  21)
    rhand = _lm_xy(mp_data.get("rightHandLandmarks"), 21)
    return np.concatenate([pose, lhand, rhand]).flatten().astype(np.float32)


def frames_to_sequence_v2(frames: list[dict]) -> np.ndarray:
    """프레임 리스트 → (T, 150) 어깨 중심 정규화 적용"""
    from app.ai_runtime.core.config import MP_LSHOULDER, MP_RSHOULDER, LOWER_BODY_START

    rows = [mediapipe_to_frame_v2(f) for f in frames]
    seq  = np.stack(rows, axis=0)   # (T, 150)

    T       = len(seq)
    pose_xy = seq[:, :66].reshape(T, 33, 2)
    ls      = pose_xy[:, MP_LSHOULDER]
    rs      = pose_xy[:, MP_RSHOULDER]
    center  = (ls + rs) / 2
    # 어깨 너비로 스케일링하여 사람 크기 차이 보정
    width   = np.linalg.norm(rs - ls, axis=1, keepdims=True).clip(min=1e-6)
    
    all_pts = seq.reshape(T, 75, 2)
    all_pts[:, :, 0] = (all_pts[:, :, 0] - center[:, 0:1]) / width
    all_pts[:, :, 1] = (all_pts[:, :, 1] - center[:, 1:2]) / width
    seq = all_pts.reshape(T, 150)

    # 하체 포인트(다리 움직임) 제로 처리 (중요도 낮음)
    seq[:, LOWER_BODY_START * 2:66] = 0.0
    return seq
