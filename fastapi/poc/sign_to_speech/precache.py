"""
keypoint zip → cache/*.npy 일회성 추출 스크립트

zip을 한 번만 열고 전체를 순차적으로 훑어서 추출 → 빠름.

실행:
    python -m sign_to_speech.precache
    python -m sign_to_speech.precache --split train
    python -m sign_to_speech.precache --split val
"""
import csv
import json
import sys
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    TRAIN_CSV, VAL_CSV,
    TRAIN_KEYPOINT_ZIP, VAL_KEYPOINT_ZIP,
    CACHE_DIR, KEYPOINT_ZIP_PREFIX,
    IMG_W, IMG_H, KEYPOINT_DIM,
)
from data_utils.keypoint_loader import parse_frame, normalize_sequence


def _read_video_names(csv_path: Path) -> list[str]:
    names = []
    with open(csv_path, encoding="euc-kr") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if len(row) >= 3 and row[2].strip():
                names.append(row[1].replace(".mp4", ""))
    return names


def _progress(done, total, t0, ok, skip, err):
    elapsed = time.time() - t0
    speed   = done / elapsed if elapsed > 0 else 0
    eta     = (total - done) / speed if speed > 0 else 0
    filled  = int(30 * done / total)
    bar     = "█" * filled + "░" * (30 - filled)
    print(
        f"  [{bar}] {done/total*100:5.1f}%  {done}/{total}"
        f"  ok={ok} skip={skip} err={err}"
        f"  {speed:.1f}it/s  ETA {eta/60:.1f}m",
        end="\r", flush=True,
    )


def _find_zips(split: str) -> list[Path]:
    """Use every available real_sen keypoint zip for the current split CSV."""
    from config import TRAIN, VAL
    zips = sorted(TRAIN.glob("*real_sen_keypoint*.zip")) + sorted(VAL.glob("*real_sen_keypoint*.zip"))
    if not zips:
        zips = [TRAIN_KEYPOINT_ZIP if split == "train" else VAL_KEYPOINT_ZIP]
    return zips


def _extract_from_zip(zip_path: Path, target: set, prefix: str) -> dict:
    """zip 하나를 열어 target 영상 keypoint 추출. {video_name: ndarray} 반환"""
    result = {}
    frame_map = defaultdict(list)

    print(f"  └ {zip_path.name} 인덱스 로드 중...", flush=True)
    with zipfile.ZipFile(zip_path) as zf:
        for entry in zf.namelist():
            if not entry.endswith("_keypoints.json"):
                continue
            parts = entry.split("/")
            video_name = parts[-2] if len(parts) >= 2 else None
            if video_name and video_name in target:
                frame_map[video_name].append(entry)

        matched = list(frame_map.keys())
        print(f"  └ 매칭: {len(matched)}개", flush=True)

        for video_name in matched:
            entries = sorted(frame_map[video_name])
            try:
                frames = [parse_frame(json.loads(zf.read(e))) for e in entries]
                seq = normalize_sequence(np.stack(frames, axis=0))
                result[video_name] = seq
            except Exception:
                pass

    return result


def precache(split: str):
    assert split in ("train", "val")
    csv_path = TRAIN_CSV if split == "train" else VAL_CSV

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_names = _read_video_names(csv_path)
    target    = {n for n in all_names if not (CACHE_DIR / f"{n}.npy").exists()}

    if not target:
        print(f"[precache/{split}] 이미 완료 ({len(all_names)}개)")
        return

    zips = _find_zips(split)
    print(f"[precache/{split}] {len(target)}/{len(all_names)}개 추출")
    print(f"  사용할 zip {len(zips)}개:")
    for z in zips:
        print(f"  └ {z.name}  ({z.stat().st_size/1024/1024:.0f}MB)")

    ok = skip = err = 0
    t0 = time.time()
    remaining = set(target)

    # ── zip 순서대로 열어 매칭되는 영상 추출 ──────────────────────────────
    for zip_path in zips:
        if not remaining:
            break
        prefix = KEYPOINT_ZIP_PREFIX.get(str(zip_path), "")
        extracted = _extract_from_zip(zip_path, remaining, prefix)

        for video_name, seq in extracted.items():
            try:
                np.save(CACHE_DIR / f"{video_name}.npy", seq)
                ok += 1
                remaining.discard(video_name)
            except Exception:
                err += 1

        _progress(len(all_names) - len(remaining), len(all_names), t0, ok, skip, err)

    # 남은 건 keypoint 없는 샘플 → skip
    skip = len(remaining)
    elapsed = time.time() - t0
    print(f"\n[precache/{split}] 완료: ok={ok}  skip={skip}  err={err}  {elapsed/60:.1f}m")
    if skip > 0:
        print(f"  ⚠ keypoint 없는 샘플 {skip}개 → 학습에서 제외됨")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["train", "val", "all"], default="all")
    args = parser.parse_args()

    if args.split in ("train", "all"):
        precache("train")
    if args.split in ("val", "all"):
        precache("val")
