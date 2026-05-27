"""
지문자(finger-spelling) / 지숫자(finger-number) 클립 DB 구축

AIHUB 지문자/지숫자 영상 zip → jamo_clips/ 추출 → jamo_db.json 생성.

jamo_db.json 구조:
{
  "ㄱ": "jamo_clips/ㄱ.mp4",
  "ㄴ": "jamo_clips/ㄴ.mp4",
  ...
  "ㅏ": "jamo_clips/ㅏ.mp4",
  ...
  "영": "jamo_clips/영.mp4",   ← 숫자 0
  "일": "jamo_clips/일.mp4",   ← 숫자 1
  ...
}

실행:
    python -m data_utils.jamo_db_builder \
        --video_zip   "경로/지문자_video.zip" \
        --morpheme_zip "경로/지문자_morpheme.zip"

클립이 없을 때도 jamo_db.json은 빈 dict {}로 존재하여
gloss_to_video.py의 폴백 로직이 graceful하게 동작.
"""
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import WORD_CLIPS_DIR, WORD_DB_PATH

# 지문자/지숫자 클립 저장 위치
JAMO_CLIPS_DIR = WORD_CLIPS_DIR.parent / "jamo_clips"
JAMO_DB_PATH   = WORD_DB_PATH.parent   / "jamo_db.json"


def load_jamo_db() -> dict:
    if JAMO_DB_PATH.exists():
        with open(JAMO_DB_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_jamo_db(db: dict):
    JAMO_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(JAMO_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    print(f"[jamo_db] 저장: {JAMO_DB_PATH} ({len(db)}개)")


def _ffmpeg_trim(src: Path, dst: Path, start: float, end: float) -> bool:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start), "-to", str(end),
        "-i", str(src),
        "-c:v", "libx264", "-crf", "23", "-an",
        str(dst),
    ]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def build(video_zip: Path, morpheme_zip: Path, overwrite: bool = False):
    """
    지문자/지숫자 video zip + morpheme zip → jamo_db.json.

    morpheme json 구조가 word_morpheme과 동일하다고 가정:
        data[0].attributes[0].name → 글로스 (예: 'ㄱ', 'ㅏ', '일' 등)
    """
    JAMO_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    db = {} if overwrite else load_jamo_db()

    print(f"[jamo_db] morpheme 로드: {morpheme_zip.name}")
    morph_index = {}
    with zipfile.ZipFile(morpheme_zip) as zf:
        for name in zf.namelist():
            if not name.endswith(".json"):
                continue
            try:
                data = json.loads(zf.read(name))
                fname = data["metaData"]["name"].replace(".mp4", "")
                if not data["data"]:
                    continue
                item  = data["data"][0]
                gloss = item["attributes"][0]["name"].strip()
                morph_index[fname] = {
                    "gloss": gloss,
                    "start": item["start"],
                    "end":   item["end"],
                }
            except Exception:
                pass
    print(f"  morpheme entries: {len(morph_index)}")

    print(f"[jamo_db] 클립 추출: {video_zip.name}")
    ok_cnt = skip_cnt = 0

    with zipfile.ZipFile(video_zip) as zf:
        mp4s = [n for n in zf.namelist() if n.endswith("_F.mp4")]

        for mp4_path in mp4s:
            video_name = Path(mp4_path).stem
            if video_name not in morph_index:
                skip_cnt += 1
                continue

            info  = morph_index[video_name]
            gloss = info["gloss"]
            dst   = JAMO_CLIPS_DIR / f"{gloss}.mp4"

            if not overwrite and gloss in db and dst.exists():
                continue

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(zf.read(mp4_path))
                tmp_path = Path(tmp.name)

            if _ffmpeg_trim(tmp_path, dst, info["start"], info["end"]):
                db[gloss] = str(dst)
                ok_cnt += 1
            else:
                skip_cnt += 1
            tmp_path.unlink(missing_ok=True)

    print(f"  추출: {ok_cnt}개 / 실패/스킵: {skip_cnt}개")
    save_jamo_db(db)
    return db


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="지문자/지숫자 DB 구축")
    parser.add_argument("--video_zip",    type=Path, required=True)
    parser.add_argument("--morpheme_zip", type=Path, required=True)
    parser.add_argument("--overwrite",    action="store_true")
    args = parser.parse_args()
    build(args.video_zip, args.morpheme_zip, args.overwrite)
