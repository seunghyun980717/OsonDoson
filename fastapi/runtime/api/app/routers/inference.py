"""
converter 연동 추론 라우터

Java converter(Spring Boot)가 호출하는 엔드포인트:
  POST /inference        — 단일 프레임 (실시간 스트림, ack만 반환)
  POST /inference/record — 전체 녹화 시퀀스 → CTC → 글로스 → 한국어

converter가 보내는 JSON 포맷 (OpenPoseResponseDTO → snake_case):
  {
    "version": 1.3,
    "people": [{
      "pose_keypoints_2d":       [...75 floats],
      "hand_left_keypoints_2d":  [...63 floats],
      "hand_right_keypoints_2d": [...63 floats],
      ...
    }]
  }
"""
from pathlib import Path
from typing import Any, List

import numpy as np
from fastapi import APIRouter, HTTPException

from runtime.api.app.state import state
from runtime.api.app.timer import PipelineTimer
from core.data_utils.mediapipe_converter import (
    parse_frame_converter,
    converter_frames_to_sequence,
)
from core.data_utils.keypoint_loader import normalize_sequence

router = APIRouter()


# ── POST /inference  (단일 프레임, 실시간) ────────────────────────────────────

@router.post("")
def inference_single(openpose_frame: dict) -> dict:
    """
    단일 프레임 OpenPose JSON 수신.
    현재는 ack만 반환 (프레임 누적은 converter/클라이언트가 관리).
    향후 슬라이딩 윈도우 추론으로 확장 가능.
    """
    return {"status": "ok", "message": "frame received"}


# ── POST /inference/record  (전체 시퀀스) ─────────────────────────────────────

@router.post("/record")
def inference_record(frames: List[dict]) -> dict:
    """
    전체 녹화 시퀀스 → CTC 추론 → 글로스 → 한국어.

    Args:
        frames: OpenPose JSON 프레임 리스트 (converter가 전송)

    Returns:
        {"gloss": "…", "korean": "…", "frame_count": N}
    """
    if not frames:
        raise HTTPException(status_code=400, detail="프레임 없음")

    timer = PipelineTimer("inference/record")

    # ── keypoint 변환 ─────────────────────────────────────────────────────
    with timer.step("keypoint 변환"):
        seq = converter_frames_to_sequence(frames)   # (T, 134)
        seq = normalize_sequence(seq)                # 어깨 기준 정규화

    # ── CTC 추론 ──────────────────────────────────────────────────────────
    with timer.step("CTC 추론"):
        model = state.ctc_model
        vocab = state.ctc_vocab

        if model is None or vocab is None:
            raise HTTPException(
                status_code=503,
                detail="CTC 모델 미로드 (checkpoints/best.pt 필요)",
            )

        import torch
        from runtime.sign_to_speech.infer import ctc_decode
        with torch.no_grad():
            device = next(model.parameters()).device
            x = torch.from_numpy(seq).float().unsqueeze(0).to(device)  # (1, T, 134)
            log_probs, _ = model(x)

        gloss_str = ctc_decode(log_probs, vocab)

    print(f"[inference/record] Gloss: {gloss_str!r}  ({len(frames)} frames)")

    # ── 글로스 → 한국어 ───────────────────────────────────────────────────
    with timer.step("글로스→한국어"):
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
        korean = gloss_to_korean(gloss_str) if gloss_str else ""

    print(f"[inference/record] Korean: {korean!r}")

    timings = timer.finish()

    return {
        "gloss":       gloss_str,
        "korean":      korean,
        "frame_count": len(frames),
        "timings":     timings,
    }
