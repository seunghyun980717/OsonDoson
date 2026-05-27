"""
Sentence morpheme + 영상에서 글로스별 클립 추출 (중복 없이)

전략:
  - sentence morpheme 전체를 스캔해 글로스별 첫 번째 F각도 구간 선택
  - word_db에 이미 있는 글로스는 스킵 (--overwrite 없으면)
  - 추출 후 word_db.json에 머지

실행:
    python -m data_utils.sentence_gloss_db_builder
    python -m data_utils.sentence_gloss_db_builder --overwrite  # 전체 재추출
"""
import json
import subprocess
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import TRAIN_MORPHEME_ZIP, WORD_CLIPS_DIR, WORD_DB_PATH

TRAIN_VIDEO_ZIP = Path(r"C:\Users\SSAFY\Downloads\수어 영상\1.Training\[원천]01_real_sen_video.zip")


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


def _collect_gloss_segments(morpheme_zip: Path) -> dict:
    """
    morpheme zip 전체 스캔 → {gloss: (video_name, start, end)}
    F각도 우선, 글로스당 하나만 저장 (먼저 나온 것)
    """
    index = {}  # gloss → (video_name, start, end)

    with zipfile.ZipFile(morpheme_zip) as zf:
        f_files = [
            n for n in zf.namelist()
            if n.endswith("_morpheme.json")
            and n.split("/")[-1].replace("_morpheme.json", "").endswith("_F")
        ]
        print(f"F각도 morpheme 파일: {len(f_files)}개")

        for mf in f_files:
            data = json.loads(zf.read(mf))
            video_name = data["metaData"]["name"].replace(".mp4", "")

            for item in data.get("data", []):
                gloss = item["attributes"][0]["name"]
                if gloss not in index:  # 글로스당 첫 번째만
                    index[gloss] = (video_name, item["start"], item["end"])

    print(f"수집된 unique 글로스: {len(index)}개")
    return index


def build(overwrite: bool = False) -> dict:
    WORD_CLIPS_DIR.mkdir(parents=True, exist_ok=True)

    # 기존 word_db 로드
    db = {}
    if WORD_DB_PATH.exists():
        with open(WORD_DB_PATH, encoding="utf-8") as f:
            db = json.load(f)
    print(f"기존 word_db: {len(db)}개 클립")

    # sentence morpheme에서 글로스-구간 수집
    print("\nMorpheme 스캔 중...")
    gloss_segments = _collect_gloss_segments(TRAIN_MORPHEME_ZIP)

    # 추출 대상: word_db에 없는 것 (overwrite면 전체)
    targets = {
        g: seg for g, seg in gloss_segments.items()
        if overwrite or g not in db
    }
    print(f"추출 대상: {len(targets)}개 (word_db 미등록)")

    if not targets:
        print("추출할 글로스 없음")
        return db

    # 영상 zip에서 클립 추출
    print("\n클립 추출 중...")
    success, fail, skip = 0, 0, 0

    with zipfile.ZipFile(TRAIN_VIDEO_ZIP) as video_zf:
        available = {
            Path(n).stem: n
            for n in video_zf.namelist()
            if n.endswith("_F.mp4")
        }
        print(f"사용 가능한 F각도 영상: {len(available)}개")

        for gloss, (video_name, start, end) in targets.items():
            dst = WORD_CLIPS_DIR / f"{gloss}.mp4"

            if dst.exists() and not overwrite:
                db[gloss] = str(dst)
                skip += 1
                continue

            if video_name not in available:
                fail += 1
                continue

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(video_zf.read(available[video_name]))
                tmp_path = Path(tmp.name)

            ok = _ffmpeg_trim(tmp_path, dst, start, end)
            tmp_path.unlink(missing_ok=True)

            if ok:
                db[gloss] = str(dst)
                success += 1
            else:
                fail += 1

            done = success + fail + skip
            if done % 50 == 0:
                print(f"  {done}/{len(targets)} | 성공 {success} / 실패 {fail} / 스킵 {skip}")

    with open(WORD_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    print(f"\n완료: 신규 {success}개 추출, {fail}개 실패, {skip}개 이미 존재")
    print(f"word_db 총 클립: {len(db)}개")
    return db


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--overwrite", action="store_true", help="이미 있는 클립도 재추출")
    args = parser.parse_args()
    build(overwrite=args.overwrite)
