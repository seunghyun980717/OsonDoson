"""
AIHUB keypoint JSON (zip) → numpy (T, 134)

feature layout (134-dim, x/y only, confidence 제외):
  [0:50]   pose 25pt × (x, y)
  [50:92]  hand_left 21pt × (x, y)
  [92:134] hand_right 21pt × (x, y)

zip별 내부 경로 prefix (config.KEYPOINT_ZIP_PREFIX 참고):
  ""            → {folder}/{video}/...  (01_real_sen train)
  "keypoint/"   → keypoint/{folder}/{video}/...  (09_real_sen, 09_real_word)
  "SEN/keypoint/" → SEN/keypoint/{folder}/{video}/...
  "WORD/keypoint/" → WORD/keypoint/{folder}/{video}/...
"""
import json
import re
import zipfile
from pathlib import Path
from typing import Optional

import numpy as np

from app.ai_runtime.core.config import IMG_W, IMG_H, KEYPOINT_DIM, CACHE_DIR, KEYPOINT_ZIP_PREFIX


def _extract_xy(flat: list, n_points: int) -> np.ndarray:
    """flat [x,y,c, x,y,c, ...] → (n_points, 2)"""
    arr = np.array(flat, dtype=np.float32).reshape(n_points, 3)
    return arr[:, :2]


def parse_frame(kp_json: dict) -> np.ndarray:
    """keypoint JSON 1프레임 → (134,) float32"""
    p = kp_json["people"]
    pose = _extract_xy(p["pose_keypoints_2d"],       25)
    h_l  = _extract_xy(p["hand_left_keypoints_2d"],  21)
    h_r  = _extract_xy(p["hand_right_keypoints_2d"], 21)

    feat = np.concatenate([pose, h_l, h_r], axis=0)  # (67, 2)
    feat[:, 0] /= IMG_W
    feat[:, 1] /= IMG_H
    return feat.flatten()  # (134,)


def normalize_sequence(seq: np.ndarray) -> np.ndarray:
    """
    (T, 134) → 어깨 중심 기준 상대 좌표 + 어깨 너비 스케일링.
    pose index: 2=rshoulder, 5=lshoulder (OpenPose 25-keypoint)
    """
    T = len(seq)
    out = seq.copy()
    pose_xy = seq[:, :50].reshape(T, 25, 2)

    r_shoulder = pose_xy[:, 2, :]
    l_shoulder = pose_xy[:, 5, :]
    center = (r_shoulder + l_shoulder) / 2
    width  = np.linalg.norm(r_shoulder - l_shoulder, axis=1, keepdims=True).clip(min=1e-6)

    out_2d = out.reshape(T, 67, 2)
    out_2d[:, :, 0] = (out_2d[:, :, 0] - center[:, 0:1]) / width
    out_2d[:, :, 1] = (out_2d[:, :, 1] - center[:, 1:2]) / width
    return out_2d.reshape(T, KEYPOINT_DIM)


def _folder_from_name(video_name: str) -> str:
    """NIA_SL_SEN0001_REAL17_F → '17', NIA_SL_WORD0001_SYN03_D → '03'"""
    m = re.search(r"(?:REAL|CROWD|SYN)(\d+)", video_name)
    return m.group(1) if m else "01"


def load_video_keypoints(
    zip_path: Path,
    video_name: str,
    *,
    zip_inner_prefix: Optional[str] = None,
    top_folder: Optional[str] = None,
    use_cache: bool = True,
    normalize: bool = True,
) -> Optional[np.ndarray]:
    """
    zip에서 video_name에 해당하는 모든 프레임을 읽어 (T, 134) 반환.

    Args:
        zip_path:         keypoint zip 파일 경로
        video_name:       'NIA_SL_SEN0001_REAL01_F' (확장자 없이)
        zip_inner_prefix: zip 내부 경로 prefix. None이면 config.KEYPOINT_ZIP_PREFIX 참조.
                          예: "", "keypoint/", "SEN/keypoint/", "WORD/keypoint/"
        top_folder:       None이면 video_name에서 자동 추론 (REAL17 → '17')
        use_cache:        True면 cache/ 폴더에 npy 저장·재사용
        normalize:        True면 어깨 기준 정규화 적용
    """
    cache_file = CACHE_DIR / f"{video_name}.npy"
    if use_cache and cache_file.exists():
        return np.load(cache_file)

    if zip_inner_prefix is None:
        zip_inner_prefix = KEYPOINT_ZIP_PREFIX.get(str(zip_path), "")

    if top_folder is None:
        top_folder = _folder_from_name(video_name)

    prefix = f"{zip_inner_prefix}{top_folder}/{video_name}/"

    try:
        with zipfile.ZipFile(zip_path) as zf:
            frame_files = sorted(
                name for name in zf.namelist()
                if name.startswith(prefix) and name.endswith("_keypoints.json")
            )
            if not frame_files:
                return None

            frames = []
            for fname in frame_files:
                data = json.loads(zf.read(fname))
                frames.append(parse_frame(data))

        seq = np.stack(frames, axis=0)  # (T, 134)

        if normalize:
            seq = normalize_sequence(seq)

        if use_cache:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            np.save(cache_file, seq)

        return seq

    except Exception as e:
        print(f"[keypoint_loader] {video_name}: {e}")
        return None
