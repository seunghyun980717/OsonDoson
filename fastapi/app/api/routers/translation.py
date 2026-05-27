from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from fastapi import File, UploadFile

from app.api.deps import get_container
from app.api.schemas import (
    GlossesToSpeechRequest,
    HealthResponse,
    RecommendRequest,
    RecommendResponse,
    SignToSpeechApiResponse,
    SignToSpeechAudioPayload,
    SignToSpeechRequest,
    SpeechToSignKeypointResponse,
    TextRequest,
)
from app.api.utils.translation import (
    build_sign_to_speech_response,
    normalize_glosses,
    save_upload_to_temp_file,
)
from app.container import RuntimeContainer
from app.services.gloss_recommend import GlossRecommendService
from app.services.sign_to_speech import SignToSpeechService
from app.services.speech_to_sign import SpeechToSignService

router = APIRouter(tags=["translation"])
logger = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse)
def health(container: RuntimeContainer = Depends(get_container)) -> HealthResponse:
    logger.info("health 요청 처리를 시작합니다.")
    response = HealthResponse(
        status="ok",
        profile=container.settings.profile.name,
        translation_backend=container.settings.translation_backend,
        device=container.device_info,
        models=container.model_status(),
        artifact_root=str(container.settings.static_dir),
    )
    logger.info("health 요청 처리가 완료되었습니다.")
    return response


@router.post("/sign-to-speech", response_model=SignToSpeechApiResponse)
def sign_to_speech(
    payload: SignToSpeechRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechApiResponse:
    logger.info("sign_to_speech 요청 처리를 시작합니다. frame 수=%s", len(payload.frames))
    service = SignToSpeechService(container)
    result = service.frames_to_speech([frame.model_dump() for frame in payload.frames])
    gloss = str(result["gloss"]).strip()
    glosses = [token for token in gloss.split() if token]
    response = build_sign_to_speech_response(result, glosses=glosses)
    logger.info("sign_to_speech 요청 처리가 완료되었습니다. gloss 수=%s", len(glosses))
    return response


@router.post("/glosses-to-speech", response_model=SignToSpeechApiResponse)
def glosses_to_speech(
    payload: GlossesToSpeechRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechApiResponse:
    logger.info("glosses_to_speech 요청 처리를 시작합니다. gloss 후보 수=%s", len(payload.glosses))
    glosses = normalize_glosses(payload.glosses)
    service = SignToSpeechService(container)
    result = service.gloss_to_speech(" ".join(glosses))
    response = build_sign_to_speech_response(result, glosses=glosses)
    logger.info("glosses_to_speech 요청 처리가 완료되었습니다. gloss 수=%s", len(glosses))
    return response


@router.post("/speech-to-sign", response_model=SpeechToSignKeypointResponse)
def speech_to_sign(
    file: UploadFile = File(...),
    container: RuntimeContainer = Depends(get_container),
) -> SpeechToSignKeypointResponse:
    logger.info("speech_to_sign 요청 처리를 시작합니다. filename=%s", file.filename)
    tmp_path = save_upload_to_temp_file(file, "input.wav")

    try:
        service = SpeechToSignService(container)
        response = SpeechToSignKeypointResponse(**service.audio_to_keypoints(tmp_path))
        logger.info("speech_to_sign 요청 처리가 완료되었습니다. filename=%s", file.filename)
        return response
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/text-to-sign", response_model=SpeechToSignKeypointResponse)
def text_to_sign(
    payload: TextRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SpeechToSignKeypointResponse:
    logger.info("text_to_sign 요청 처리를 시작합니다.")
    service = SpeechToSignService(container)
    response = SpeechToSignKeypointResponse(**service.text_to_keypoints(payload.text))
    logger.info("text_to_sign 요청 처리가 완료되었습니다.")
    return response


@router.post("/glosses/recommend", response_model=RecommendResponse)
def recommend(
    req: RecommendRequest,
    container: RuntimeContainer = Depends(get_container),
) -> RecommendResponse:
    logger.info("recommend 요청 처리를 시작합니다. category=%s sequence 수=%s", req.category, len(req.sequence))
    service = GlossRecommendService(container)
    response = RecommendResponse(recommendations=service.recommend(req.category, req.sequence))
    logger.info("recommend 요청 처리가 완료되었습니다.")
    return response
