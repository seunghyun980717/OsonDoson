from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import UploadFile

from app.api.exceptions import GlossListEmptyError, UploadFileSaveError
from app.api.schemas import SignToSpeechApiResponse, SignToSpeechAudioPayload

logger = logging.getLogger(__name__)


def save_upload_to_temp_file(file: UploadFile, default_name: str) -> Path:
    """
    업로드된 파일을 임시 디렉터리에 저장한 뒤,
    생성된 임시 파일 경로를 반환한다.
    """
    suffix = Path(file.filename or default_name).suffix or Path(default_name).suffix
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            shutil.copyfileobj(file.file, handle)
            return Path(handle.name)
    except Exception as exc:
        logger.exception("업로드 파일 임시 저장 중 오류가 발생했습니다. filename=%s", file.filename)
        raise UploadFileSaveError(f"업로드 파일을 임시 저장하지 못했습니다. error={exc}") from exc


def normalize_glosses(glosses: list[str]) -> list[str]:
    normalized = [gloss.strip() for gloss in glosses if gloss and gloss.strip()]
    if not normalized:
        logger.warning("gloss 목록 정제 결과가 비어 있습니다.")
        raise GlossListEmptyError()
    return normalized


def build_sign_to_speech_response(
    result: dict[str, object],
    *,
    glosses: list[str],
) -> SignToSpeechApiResponse:
    audio_url = result.get("audio_url")
    audio = None

    if isinstance(audio_url, str) and audio_url.strip():
        audio = SignToSpeechAudioPayload(
            format="mp3",
            content_type="audio/mpeg",
            url=audio_url,
        )

    return SignToSpeechApiResponse(
        type="sign_to_speech_result",
        source="signer",
        glosses=glosses,
        korean=str(result["korean"]),
        audio_url=audio_url,
        audio=audio,
    )
