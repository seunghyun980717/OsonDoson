from __future__ import annotations

import asyncio
import base64
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from app.ai_runtime.state import get_ai_runtime_state


async def run_sign_to_speech(app: FastAPI, frames: list[dict[str, Any]]) -> dict[str, Any]:
    runtime_state = get_ai_runtime_state(app)
    raw_result = await asyncio.to_thread(runtime_state.sign_to_speech.frames_to_speech, frames)

    gloss = raw_result.get("gloss", "").strip()
    if not gloss:
        raise ValueError("sign_to_speech result is missing gloss text")

    return {
        "gloss": gloss,
        "glosses": gloss.split(),
        "korean": raw_result.get("korean"),
        "audio_url": raw_result.get("audio_url"),
        "audio_path": raw_result.get("audio_path"),
        "frame_count": raw_result.get("frame_count"),
        "timings": raw_result.get("timings", {}),
    }


async def run_speech_to_sign_text(app: FastAPI, text: str) -> dict[str, Any]:
    runtime_state = get_ai_runtime_state(app)
    raw_result = await asyncio.to_thread(runtime_state.speech_to_sign.text_to_keypoints, text)
    return _normalize_speech_to_sign_result(raw_result)


async def run_speech_to_sign_audio(
    app: FastAPI,
    audio_base64: str,
    audio_format: str,
) -> dict[str, Any]:
    runtime_state = get_ai_runtime_state(app)

    try:
        audio_bytes = base64.b64decode(audio_base64, validate=True)
    except Exception as exc:
        raise ValueError(f"invalid base64 audio payload: {exc}") from exc

    suffix = f".{audio_format.strip().lower()}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(audio_bytes)
        tmp_path = Path(handle.name)

    try:
        from app.ai_runtime.runtime.speech_to_sign.stt import transcribe_file

        def _transcribe() -> str:
            return transcribe_file(tmp_path, model=runtime_state.container.get_stt_model())

        korean = await asyncio.to_thread(_transcribe)
        print(
            "[stt] audio file info: path={path} format={fmt} bytes={size}".format(
                path=tmp_path,
                fmt=audio_format,
                size=tmp_path.stat().st_size,
            )
        )
        print(f"[stt] transcribed korean={korean!r}")
        raw_result = await asyncio.to_thread(runtime_state.speech_to_sign.text_to_keypoints, korean)
        result = _normalize_speech_to_sign_result(raw_result)
        result["source_audio"] = str(tmp_path)
        result["stt_korean"] = korean
        return result
    finally:
        tmp_path.unlink(missing_ok=True)


def _normalize_speech_to_sign_result(raw_result: dict[str, Any]) -> dict[str, Any]:
    return {
        "korean": raw_result.get("korean"),
        "glosses": raw_result.get("glosses", []),
        "gloss_str": raw_result.get("gloss_str"),
        "keypoint_url": raw_result.get("keypoint_url"),
        "keypoint_path": raw_result.get("keypoint_path"),
        "keypoint_payload": raw_result.get("keypoint_payload", {}),
        "resolved_glosses": raw_result.get("resolved_glosses", []),
        "missing_glosses": raw_result.get("missing_glosses", []),
        "coverage": raw_result.get("coverage", 0.0),
        "timings": raw_result.get("timings", {}),
    }
