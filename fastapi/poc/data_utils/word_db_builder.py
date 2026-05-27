"""
Speech-to-Sign용 단어 영상 DB 구축

word video zip(F각도만) + word morpheme zip
→ 글로스별 영상 클립 추출 → WORD_CLIPS_DIR/{gloss}.mp4
→ WORD_DB_PATH (word_db.json): {"버스": "word_clips/버스.mp4", ...}

실행:
    python -m data_utils.word_db_builder
"""
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import WORD_VIDEO_ZIP, WORD_MORPHEME_ZIP, WORD_CLIPS_DIR, WORD_DB_PATH


def _ffmpeg_trim(src: Path, dst: Path, start: float, end: float) -> bool:
    """ffmpeg로 start~end 구간만 잘라내기"""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", str(src),
        "-c:v", "libx264", "-crf", "23",
        "-an",  # 오디오 제거
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0


def _load_morpheme_index(morpheme_zip: Path) -> dict:
    """morpheme zip → {video_name: {gloss, start, end}}"""
    index = {}
    with zipfile.ZipFile(morpheme_zip) as zf:
        morpheme_files = [n for n in zf.namelist() if n.endswith("_morpheme.json")]
        for mf in morpheme_files:
            data = json.loads(zf.read(mf))
            fname = data["metaData"]["name"].replace(".mp4", "")
            if not data["data"]:
                continue
            item = data["data"][0]
            gloss = item["attributes"][0]["name"]
            index[fname] = {
                "gloss": gloss,
                "start": item["start"],
                "end":   item["end"],
            }
    return index


def _extract_clips(
    video_zip: Path,
    morph_index: dict,
    db: dict,
    overwrite: bool = False,
    max_words: int = None,
) -> dict:
    """video_zip에서 F각도 클립 추출 후 db에 추가. 기존 글로스는 스킵."""
    WORD_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    processed = 0
    skipped = 0
    already = 0

    with zipfile.ZipFile(video_zip) as zf:
        mp4s = [n for n in zf.namelist() if n.endswith("_F.mp4")]
        if max_words:
            mp4s = mp4s[:max_words]
        total = len(mp4s)

        for mp4_path in mp4s:
            video_name = Path(mp4_path).stem

            if video_name not in morph_index:
                skipped += 1
                continue

            info  = morph_index[video_name]
            gloss = info["gloss"]
            dst   = WORD_CLIPS_DIR / f"{gloss}.mp4"

            # append 모드: 이미 DB에 있는 글로스는 스킵
            if not overwrite and gloss in db and dst.exists():
                already += 1
                continue

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(zf.read(mp4_path))
                tmp_path = Path(tmp.name)

            ok = _ffmpeg_trim(tmp_path, dst, info["start"], info["end"])
            tmp_path.unlink(missing_ok=True)

            if ok:
                db[gloss] = str(dst)
                processed += 1
                if processed % 100 == 0:
                    print(f"  {processed} 추가됨 (전체 {total}개 중)...")
            else:
                skipped += 1

    print(f"  새로 추출: {processed}개 / 기존 스킵: {already}개 / 실패: {skipped}개")
    return db


def build(
    overwrite:    bool = False,
    max_words:    int  = None,
    video_zip:    Path = None,
    morpheme_zip: Path = None,
) -> dict:
    """
    word_db.json 빌드 또는 append.

    Args:
        overwrite:    True면 기존 DB 무시하고 전체 재구축
        max_words:    테스트용 처리 수 제한
        video_zip:    추가할 단어 영상 zip (None이면 config.WORD_VIDEO_ZIP)
        morpheme_zip: 대응 형태소 zip    (None이면 config.WORD_MORPHEME_ZIP)

    Returns:
        {gloss: clip_path_str}
    """
    v_zip = Path(video_zip)    if video_zip    else WORD_VIDEO_ZIP
    m_zip = Path(morpheme_zip) if morpheme_zip else WORD_MORPHEME_ZIP

    # 기존 DB 로드 (overwrite=False면 이어서 추가)
    db = {}
    if WORD_DB_PATH.exists() and not overwrite:
        with open(WORD_DB_PATH, encoding="utf-8") as f:
            db = json.load(f)
        print(f"[word_db_builder] 기존 DB 로드: {len(db)}개")

    print(f"[word_db_builder] morpheme 인덱스 로드: {m_zip.name}")
    morph_index = _load_morpheme_index(m_zip)
    print(f"  morpheme entries: {len(morph_index)}")

    print(f"[word_db_builder] 클립 추출 시작: {v_zip.name}")
    db = _extract_clips(v_zip, morph_index, db, overwrite=overwrite, max_words=max_words)

    with open(WORD_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    print(f"[word_db_builder] 저장 완료: {WORD_DB_PATH} ({len(db)}개)")
    return db


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="word_db 구축 / 추가")
    parser.add_argument("--overwrite",    action="store_true",
                        help="기존 DB 무시하고 전체 재구축")
    parser.add_argument("--max_words",    type=int, default=None,
                        help="테스트용 처리 수 제한")
    parser.add_argument("--video_zip",    type=str, default=None,
                        help="추가할 단어 영상 zip 경로 (기본: config.WORD_VIDEO_ZIP)")
    parser.add_argument("--morpheme_zip", type=str, default=None,
                        help="대응 형태소 zip 경로  (기본: config.WORD_MORPHEME_ZIP)")
    args = parser.parse_args()
    build(
        overwrite=args.overwrite,
        max_words=args.max_words,
        video_zip=args.video_zip,
        morpheme_zip=args.morpheme_zip,
    )
