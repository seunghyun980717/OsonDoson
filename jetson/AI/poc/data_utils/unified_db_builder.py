"""
통합 글로스 DB 빌드 (word_db.json)

word_db_builder.py + sentence_gloss_db_builder.py 를 대체.
모든 morpheme/영상 zip을 스캔해 단일 word_db.json 구축.

전략:
  1. morpheme zip 전체 스캔 → gloss별 (video_stem, start, end) 수집
     우선순위: 단어영상 morpheme > 문장영상 morpheme (먼저 등록된 것 유지)
  2. 모든 영상 zip에서 F각도 mp4 인덱스 빌드
  3. gloss별 클립 추출 → word_clips/{gloss}.mp4
  4. word_db.json 저장 (기존 항목은 --rebuild 없으면 유지)

글로스 정제 규칙:
  - 앞뒤 공백 제거
  - 선행 쉼표(,) 제거
  - 빈 문자열 제외

실행:
    python -m data_utils.unified_db_builder
    python -m data_utils.unified_db_builder --rebuild   # 전체 재추출
"""
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, Optional, Tuple

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    WORD_MORPHEME_ZIP,
    TRAIN_SEN_MORPHEME_ZIP, VAL_SEN_09_MORPHEME_ZIP,
    WORD_VIDEO_ZIP, SEN_01_VIDEO_ZIP, SEN_09_VIDEO_ZIP,
    WORD_CLIPS_DIR, WORD_DB_PATH,
)

# morpheme 소스 (순서 = 우선순위: 먼저 등록된 gloss를 덮어쓰지 않음)
MORPHEME_SOURCES = [
    WORD_MORPHEME_ZIP,       # 단어 영상: gloss 1개씩, 가장 깔끔한 세그먼트
    TRAIN_SEN_MORPHEME_ZIP,  # 문장 영상 train: 추가 글로스 커버
    VAL_SEN_09_MORPHEME_ZIP, # 문장 영상 val
]

# 영상 소스 (F각도 클립 추출, 순서 = 우선순위)
VIDEO_SOURCES = [
    WORD_VIDEO_ZIP,   # 단어 영상 (단독 단어 클립, 가장 깔끔)
    SEN_01_VIDEO_ZIP, # 문장 영상 train
    SEN_09_VIDEO_ZIP, # 문장 영상 val
]


def _clean_gloss(raw: str) -> str:
    g = raw.strip().lstrip(",").strip()
    return g


def collect_gloss_segments() -> Dict[str, Tuple[str, float, float]]:
    """
    모든 morpheme zip 스캔 → {gloss: (video_stem, start, end)}
    F각도(_F_morpheme.json)만 사용. 먼저 등록된 gloss는 덮어쓰지 않음.
    """
    index: Dict[str, Tuple[str, float, float]] = {}

    for morph_zip in MORPHEME_SOURCES:
        if not morph_zip.exists():
            print(f"[unified_db] 스킵 (없음): {morph_zip.name}")
            continue

        with zipfile.ZipFile(morph_zip) as zf:
            f_files = [n for n in zf.namelist() if n.endswith("_F_morpheme.json")]
            print(f"[unified_db] {morph_zip.name}: F각도 {len(f_files)}개")

            for mf in f_files:
                data = json.loads(zf.read(mf).decode("utf-8"))
                video_stem = Path(data["metaData"]["name"]).stem  # NIA_SL_WORD0001_REAL17_F

                for item in data.get("data", []):
                    g = _clean_gloss(item["attributes"][0]["name"])
                    if not g or g in index:
                        continue
                    index[g] = (video_stem, float(item["start"]), float(item["end"]))

    print(f"[unified_db] 수집된 unique 글로스: {len(index)}개")
    return index


def build_video_index() -> Dict[str, Tuple[Path, str]]:
    """
    모든 영상 zip에서 F각도 mp4 인덱스 빌드.
    {video_stem: (zip_path, inner_path)}
    먼저 등록된 소스(단어 영상)가 우선.
    """
    index: Dict[str, Tuple[Path, str]] = {}

    for vid_zip in VIDEO_SOURCES:
        if not vid_zip.exists():
            print(f"[unified_db] 영상 스킵 (없음): {vid_zip.name}")
            continue

        with zipfile.ZipFile(vid_zip) as zf:
            count = 0
            for name in zf.namelist():
                if name.endswith("_F.mp4"):
                    stem = Path(name).stem
                    if stem not in index:
                        index[stem] = (vid_zip, name)
                        count += 1
            print(f"[unified_db] {vid_zip.name}: F각도 영상 {count}개 인덱싱")

    print(f"[unified_db] 전체 F각도 영상: {len(index)}개")
    return index


def _ffmpeg_trim(src: Path, dst: Path, start: float, end: float) -> bool:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(round(start, 3)),
        "-to", str(round(end, 3)),
        "-i", str(src),
        "-c:v", "libx264", "-crf", "23", "-an",
        str(dst),
    ]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def build(rebuild: bool = False) -> dict:
    """
    word_db.json 통합 빌드.

    Args:
        rebuild: True면 기존 클립 포함 전체 재추출

    Returns:
        {gloss: clip_path_str}
    """
    WORD_CLIPS_DIR.mkdir(parents=True, exist_ok=True)

    # 기존 DB 로드
    db: dict = {}
    if WORD_DB_PATH.exists() and not rebuild:
        with open(WORD_DB_PATH, encoding="utf-8") as f:
            db = json.load(f)
        print(f"[unified_db] 기존 word_db: {len(db)}개 로드")

    # 전체 글로스-구간 수집
    gloss_segments = collect_gloss_segments()

    # 영상 인덱스 빌드
    video_index = build_video_index()

    # 추출 대상: DB에 없거나 파일이 없는 글로스
    targets = {
        g: seg for g, seg in gloss_segments.items()
        if rebuild or g not in db or not Path(db.get(g, "")).exists()
    }
    print(f"\n[unified_db] 추출 대상: {len(targets)}개")

    if not targets:
        print("[unified_db] 추출할 글로스 없음. 완료.")
        _save(db)
        return db

    success = fail = skip = 0

    for gloss, (video_stem, start, end) in targets.items():
        dst = WORD_CLIPS_DIR / f"{gloss}.mp4"

        # 이미 클립이 있으면 DB만 등록 (rebuild 아닌 경우)
        if dst.exists() and not rebuild:
            db[gloss] = str(dst)
            skip += 1
            continue

        if video_stem not in video_index:
            fail += 1
            continue

        vid_zip, inner_path = video_index[video_stem]

        with zipfile.ZipFile(vid_zip) as zf:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(zf.read(inner_path))
                tmp_path = Path(tmp.name)

        ok = _ffmpeg_trim(tmp_path, dst, start, end)
        tmp_path.unlink(missing_ok=True)

        if ok:
            db[gloss] = str(dst)
            success += 1
        else:
            fail += 1

        done = success + fail + skip
        if done % 100 == 0:
            print(f"  {done}/{len(targets)} | 성공 {success} / 실패 {fail} / 스킵 {skip}")
            _save(db)  # 중간 저장

    _save(db)
    print(f"\n완료: 신규 {success}개 / 실패 {fail}개 / 스킵 {skip}개")
    print(f"word_db 총 클립: {len(db)}개")
    return db


def _save(db: dict):
    with open(WORD_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="통합 글로스 DB 빌드")
    parser.add_argument("--rebuild", action="store_true", help="전체 재추출 (기존 클립 포함)")
    args = parser.parse_args()
    build(rebuild=args.rebuild)
