"""
한국어 텍스트 → 음성 (TTS)

우선순위:
  1. gTTS (인터넷 필요, 무료)
  2. pyttsx3 (오프라인 fallback)
"""
import os
import platform
import subprocess
from pathlib import Path


def speak(text: str, output_path: Path = None, play: bool = True) -> Path:
    """
    text를 음성으로 변환.

    Args:
        text:        한국어 문장
        output_path: mp3 저장 경로 (None이면 임시파일)
        play:        True면 즉시 재생

    Returns:
        저장된 음성 파일 경로
    """
    if output_path is None:
        import tempfile
        output_path = Path(tempfile.mktemp(suffix=".mp3"))

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang="ko", slow=False)
        tts.save(str(output_path))
    except ImportError:
        print("[tts] gTTS 없음 → pyttsx3 fallback")
        _pyttsx3_speak(text, output_path)
    except Exception as e:
        print(f"[tts] gTTS error: {e} → pyttsx3 fallback")
        _pyttsx3_speak(text, output_path)

    if play and output_path.exists():
        _play(output_path)

    return output_path


def _pyttsx3_speak(text: str, output_path: Path):
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty("rate", 150)
        # 한국어 voice 있으면 설정
        for v in engine.getProperty("voices"):
            if "korean" in v.name.lower() or "ko" in v.id.lower():
                engine.setProperty("voice", v.id)
                break
        engine.save_to_file(text, str(output_path))
        engine.runAndWait()
    except Exception as e:
        print(f"[tts] pyttsx3 error: {e}")


def _play(path: Path):
    system = platform.system()
    try:
        if system == "Windows":
            os.startfile(str(path))
        elif system == "Darwin":
            subprocess.run(["afplay", str(path)])
        else:
            for player in ("mpg321", "mpg123", "ffplay"):
                if subprocess.run(["which", player], capture_output=True).returncode == 0:
                    subprocess.run([player, "-q", str(path)])
                    break
    except Exception as e:
        print(f"[tts] 재생 오류: {e}. 파일 직접 열기: {path}")
