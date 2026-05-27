"""
음성 → 텍스트 (Whisper STT)

실시간 스트리밍 고려:
  - 파일 입력: transcribe_file()
  - 마이크 스트리밍: transcribe_stream() (청크 단위)
  - VAD(음성 구간 감지) 통합으로 불필요한 추론 제거
"""
import io
import torch
import queue
import threading
from pathlib import Path
from typing import Callable, Generator, Optional


def load_model(model_size: str = "small"):
    """whisper 모델 로드 (최초 1회만 다운로드)"""

    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        import whisper
        model = whisper.load_model(model_size, device=device);
        print(f"[stt] Whisper '{model_size}' loaded on {device}")
        return model
    except ImportError:
        raise ImportError("whisper 없음: pip install openai-whisper")


def transcribe_file(audio_path: Path, model=None, model_size: str = "small") -> str:
    """
    음성 파일 → 한국어 텍스트.
    긴 파일도 Whisper가 자동으로 청크 분할 처리.
    """
    if model is None:
        model = load_model(model_size)
    result = model.transcribe(str(audio_path), language="ko")
    return result["text"].strip()


def transcribe_stream(
    model=None,
    model_size: str = "small",
    sample_rate: int = 16000,
    chunk_sec: float = 3.0,
    on_result: Optional[Callable[[str], None]] = None,
) -> Generator[str, None, None]:
    """
    마이크 실시간 스트리밍 → 텍스트 제너레이터.
    chunk_sec 단위로 녹음 후 Whisper 추론.

    사용법:
        for text in transcribe_stream(on_result=print):
            pass  # on_result 콜백 또는 yield로 처리
    """
    try:
        import sounddevice as sd
        import numpy as np
    except ImportError:
        raise ImportError("sounddevice 없음: pip install sounddevice")

    if model is None:
        model = load_model(model_size)

    chunk_size = int(sample_rate * chunk_sec)
    print(f"[stt] 실시간 녹음 시작 (청크={chunk_sec}초, Ctrl+C로 종료)")

    audio_queue: queue.Queue = queue.Queue()

    def _callback(indata, frames, time_info, status):
        audio_queue.put(indata.copy())

    with sd.InputStream(
        samplerate=sample_rate,
        channels=1,
        dtype="float32",
        blocksize=chunk_size,
        callback=_callback,
    ):
        try:
            while True:
                chunk = audio_queue.get()  # (chunk_size, 1)
                audio = chunk[:, 0]        # (chunk_size,)

                # 무음 구간 스킵 (VAD 간이 구현)
                if audio.max() < 0.01:
                    continue

                result = model.transcribe(
                    audio, language="ko", fp16=False,
                )
                text = result["text"].strip()
                if text:
                    if on_result:
                        on_result(text)
                    yield text

        except KeyboardInterrupt:
            print("[stt] 스트리밍 종료")
