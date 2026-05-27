"""
Sign-to-Speech 전체 파이프라인 데모

농인 수어 영상 → 글로스 → 한국어 텍스트 → 음성

실행:
    # 학습된 모델로 영상 파일 추론
    python demo_sign_to_speech.py --video input_sign.mp4

    # AIHUB 샘플 데이터로 테스트 (keypoint 직접 로드)
    python demo_sign_to_speech.py --sample NIA_SL_SEN1912_REAL01_F


# 예시
python demo_sign_to_speech.py --sample NIA_SL_SEN1912_REAL01_F
python demo_sign_to_speech.py --sample NIA_SL_SEN1183_REAL01_F
python demo_sign_to_speech.py --sample NIA_SL_SEN0814_REAL01_F


"""

import argparse
from pathlib import Path

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import TRAIN_KEYPOINT_ZIP
from data_utils.keypoint_loader import load_video_keypoints
from sign_to_speech.gloss_to_korean import gloss_to_korean
from sign_to_speech.tts import speak


def run_with_model(video_path: Path, output_audio: Path = None):
    """학습된 모델로 수어 영상 → 음성"""
    from sign_to_speech.infer import infer
    result = infer(video_path=video_path, do_tts=True, output_audio=output_audio)
    print(f"글로스:  {result['gloss']}")
    print(f"한국어:  {result['korean']}")
    print(f"음성:    {result['audio']}")


def run_with_sample(video_name: str):
    """
    AIHUB 샘플 keypoint로 파이프라인 경로 검증.
    모델 학습 전에도 gloss_to_korean + TTS 동작 확인용.
    """
    print(f"[샘플 테스트] {video_name}")
    print("keypoint 로드 중...")
    kp = load_video_keypoints(TRAIN_KEYPOINT_ZIP, video_name, use_cache=True)
    if kp is None:
        print("keypoint 로드 실패")
        return

    print(f"  shape: {kp.shape}  (T={kp.shape[0]} frames)")

    # 모델 없이 글로스는 CSV에서 직접 읽기 (파이프라인 검증용)
    import csv
    from config import TRAIN_CSV, VAL_CSV
    gloss_str = None
    for csv_path in [TRAIN_CSV, VAL_CSV]:
        if not csv_path.exists():
            continue
        with open(csv_path, encoding="euc-kr") as f:
            reader = csv.reader(f)
            next(reader)  # header
            for row in reader:
                if len(row) >= 3 and row[1].replace(".mp4", "") == video_name:
                    gloss_str = row[2].strip()
                    break
        if gloss_str:
            break

    if not gloss_str:
        # CSV에 없으면 임의의 유효한 샘플 사용
        with open(TRAIN_CSV, encoding="euc-kr") as f:
            reader = csv.reader(f)
            next(reader)
            row = next(reader)
            gloss_str = row[2].strip()
            video_name = row[1].replace(".mp4", "")
            print(f"  (CSV에 없음 → 다른 샘플 사용: {video_name})")
            kp = load_video_keypoints(TRAIN_KEYPOINT_ZIP, video_name, use_cache=True)
            if kp is not None:
                print(f"  shape: {kp.shape}")

    print(f"  글로스 (CSV): {gloss_str}")

    print("글로스 → 한국어 변환...")
    korean = gloss_to_korean(gloss_str)
    print(f"  한국어: {korean}")

    print("TTS 생성...")
    audio = speak(korean, output_path=Path("sample_output.mp3"), play=True)
    print(f"  음성: {audio}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video",  type=Path, default=None, help="수어 영상 파일")
    parser.add_argument("--sample", type=str,  default=None, help="AIHUB 샘플 영상명 (모델 없이 테스트)")
    parser.add_argument("--output", type=Path, default=None, help="출력 음성 파일")
    args = parser.parse_args()

    print("=" * 50)
    print("Sign-to-Speech Pipeline")
    print("=" * 50)

    if args.sample:
        run_with_sample(args.sample)
    elif args.video:
        run_with_model(args.video, args.output)
    else:
        # 기본: 샘플로 파이프라인 테스트
        run_with_sample("NIA_SL_SEN0001_REAL01_F")
