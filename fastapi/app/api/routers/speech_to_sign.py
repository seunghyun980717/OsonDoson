from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile

from app.api.deps import get_container
from app.api.schemas import SpeechToSignKeypointResponse, SpeechToSignResponse, TextRequest
from app.container import RuntimeContainer
from app.services.speech_to_sign import SpeechToSignService

router = APIRouter(prefix="/speech-to-sign", tags=["speech-to-sign"])


@router.post("/text", response_model=SpeechToSignResponse)
def text_to_sign(
    payload: TextRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SpeechToSignResponse:
    service = SpeechToSignService(container)
    return SpeechToSignResponse(**service.text_to_sign(payload.text))


@router.post("/text/keypoints", response_model=SpeechToSignKeypointResponse)
def text_to_keypoints(
    payload: TextRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SpeechToSignKeypointResponse:
    service = SpeechToSignService(container)
    return SpeechToSignKeypointResponse(**service.text_to_keypoints(payload.text))


@router.post("/audio", response_model=SpeechToSignResponse)
def audio_to_sign(
    file: UploadFile = File(...),
    container: RuntimeContainer = Depends(get_container),
) -> SpeechToSignResponse:
    suffix = Path(file.filename or "input.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        shutil.copyfileobj(file.file, handle)
        tmp_path = Path(handle.name)
    try:
        service = SpeechToSignService(container)
        return SpeechToSignResponse(**service.audio_to_sign(tmp_path))
    finally:
        tmp_path.unlink(missing_ok=True)

