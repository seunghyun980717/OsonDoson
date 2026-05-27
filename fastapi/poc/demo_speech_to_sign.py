"""
Speech-to-Sign 전체 파이프라인 데모

청인 음성 → 한국어 텍스트 → 글로스 시퀀스 → 수어 영상

실행:
    # 마이크 입력 (3초)
    python demo_speech_to_sign.py

    # 음성 파일 입력
    python demo_speech_to_sign.py --audio input.wav

    # 텍스트 직접 입력 (STT 스킵)
    python demo_speech_to_sign.py --text "지하철 환승은 어떻게 하나요?"
"""
import argparse
from pathlib import Path

from speech_to_sign.stt              import load_model as load_stt, transcribe_file
from speech_to_sign.korean_to_gloss  import korean_to_gloss
from speech_to_sign.gloss_to_video   import glosses_to_video, load_word_db


def run(audio: Path = None, text: str = None, output: Path = Path("output_sign.mp4")):
    print("=" * 50)
    print("Speech-to-Sign Pipeline")
    print("=" * 50)

    # Step 1: STT
    if text:
        korean = text
        print(f"[1] 텍스트 입력: {korean}")
    elif audio:
        print(f"[1] STT: {audio}")
        model = load_stt("small")
        korean = transcribe_file(audio, model=model)
        print(f"    → {korean}")
    else:
        # 마이크 3초
        import sounddevice as sd
        import numpy as np
        import whisper
        print("[1] 마이크 녹음 중... (3초)")
        audio_data = sd.rec(int(3 * 16000), samplerate=16000, channels=1, dtype="float32")
        sd.wait()
        model = whisper.load_model("small")
        result = model.transcribe(audio_data[:, 0], language="ko", fp16=False)
        korean = result["text"].strip()
        print(f"    → {korean}")

    # Step 2: 한국어 → 글로스
    print(f"\n[2] 글로스 변환")
    glosses = korean_to_gloss(korean)
    print(f"    → {' '.join(glosses)}")

    # Step 3: 글로스 → 수어 영상
    print(f"\n[3] 수어 영상 생성")
    word_db = load_word_db()
    result_path = glosses_to_video(glosses, output=output, word_db=word_db)

    print("\n" + "=" * 50)
    if result_path:
        print(f"완료: {result_path}")
    else:
        print("영상 생성 실패 (word_db 구축 필요: python -m data_utils.word_db_builder)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio",  type=Path, default=None)
    parser.add_argument("--text",   type=str,  default=None)
    parser.add_argument("--output", type=Path, default=Path("output_sign.mp4"))
    args = parser.parse_args()
    run(audio=args.audio, text=args.text, output=args.output)
