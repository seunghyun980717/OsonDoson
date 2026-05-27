"""
Sign-to-Speech 추론 (sign-v2)

입력: numpy keypoint (T, 150)  ← 영상→keypoint 변환은 별도 모듈 담당
출력: 글로스 시퀀스 → 한국어 텍스트 → 음성 파일
"""
import argparse
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from app.ai_runtime.core.config import CHECKPOINTS_DIR
from app.ai_runtime.core.sign_to_speech.dataset import Vocabulary
from app.ai_runtime.core.sign_to_speech.model import build_sign_model, ctc_greedy_decode
from app.ai_runtime.runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
from app.ai_runtime.runtime.sign_to_speech.tts import speak
from app.ai_runtime.runtime.sign_to_speech.mediapipe_converter import mediapipe_to_frame_v2, frames_to_sequence_v2


def get_runtime_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def get_runtime_device_info() -> dict:
    device = get_runtime_device()
    info = {
        "device": device.type,
        "use_fp16": device.type == "cuda",
        "gpu_name": None,
    }
    if device.type == "cuda":
        props = torch.cuda.get_device_properties(0)
        info["gpu_name"] = props.name
        info["vram_gb"] = round(props.total_memory / (1024 ** 3), 2)
    else:
        info["vram_gb"] = 0.0
    return info


def load_model(ckpt_path: Optional[Path] = None):
    if ckpt_path is None:
        ckpt_path = CHECKPOINTS_DIR / "best.pt"
    ckpt  = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    vocab = Vocabulary()
    vocab.tokens = ckpt["vocab"]
    vocab.stoi   = {t: i for i, t in enumerate(vocab.tokens)}
    model = build_sign_model(vocab_size=len(vocab))
    model.load_state_dict(ckpt["model"])
    device = get_runtime_device()
    model.to(device).eval()
    print(f"[sign_to_speech] CTC model ready on {device}")
    return model, vocab


# Backward-compatible alias used by older runtime routers.
ctc_decode = ctc_greedy_decode


@torch.no_grad()
def infer(
    keypoints:    np.ndarray,
    ckpt_path:    Optional[Path] = None,
    do_tts:       bool = True,
    output_audio: Optional[Path] = None,
) -> dict:
    """
    Args:
        keypoints: (T, 150) float32  ← 외부에서 추출해서 넘겨줌

    Returns:
        {"gloss": "...", "korean": "...", "audio": Path or None}
    """
    model, vocab = load_model(ckpt_path)
    device = next(model.parameters()).device

    x = torch.from_numpy(keypoints).float().unsqueeze(0).to(device)  # (1, T, 150)
    lengths = torch.tensor([x.shape[1]], dtype=torch.long, device=device)
    log_probs, _ = model(x, lengths=lengths)

    gloss_str = ctc_greedy_decode(log_probs, vocab)[0]
    print(f"[infer] Gloss: {gloss_str}")

    korean = gloss_to_korean(gloss_str)
    print(f"[infer] Korean: {korean}")

    audio_path = None
    if do_tts and korean:
        audio_path = output_audio or Path(tempfile.mktemp(suffix=".mp3"))
        speak(korean, output_path=audio_path)
        print(f"[infer] Audio: {audio_path}")

    return {"gloss": gloss_str, "korean": korean, "audio": audio_path}


def keypoints_from_json_dir(json_dir: Path) -> np.ndarray:
    """
    프레임별 keypoint JSON 파일 폴더 → (T, 150).
    파일명 오름차순으로 프레임 순서 결정.
    """
    import json
    files = sorted(json_dir.glob("*.json"))
    if not files:
        raise FileNotFoundError(f"JSON 파일 없음: {json_dir}")
    frames = [json.loads(f.read_text(encoding="utf-8")) for f in files]
    return frames_to_sequence_v2(frames)


def keypoints_from_json_file(json_path: Path) -> np.ndarray:
    """
    단일 JSON 파일 → (T, 150).
    """
    import json
    data = json.loads(json_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        frames = data
    else:
        frames = [data]
    return frames_to_sequence_v2(frames)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--json_dir", type=Path,
                       help="프레임별 keypoint JSON 폴더")
    group.add_argument("--json",     type=Path,
                       help="단일 keypoint JSON 파일 (프레임 배열 또는 단일 프레임)")
    parser.add_argument("--ckpt",   type=Path, default=None)
    parser.add_argument("--no_tts", action="store_true")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    if args.json_dir:
        kp = keypoints_from_json_dir(args.json_dir)
    else:
        kp = keypoints_from_json_file(args.json)

    result = infer(
        keypoints    = kp,
        ckpt_path    = args.ckpt,
        do_tts       = not args.no_tts,
        output_audio = args.output,
    )
    print(result)
