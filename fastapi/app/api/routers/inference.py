from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_container
from app.container import RuntimeContainer
from app.services.sign_to_speech import SignToSpeechService

router = APIRouter(prefix="/inference", tags=["inference"])


@router.post("")
def inference_single(_: dict) -> dict[str, str]:
    return {"status": "ok", "message": "frame received"}


@router.post("/record")
def inference_record(
    frames: list[dict],
    container: RuntimeContainer = Depends(get_container),
) -> dict[str, object]:
    if not frames:
        raise HTTPException(status_code=400, detail="No frames were provided.")
    service = SignToSpeechService(container)
    result = service.frames_to_speech(frames)
    return {
        "gloss": result["gloss"],
        "korean": result["korean"],
        "audio_url": result["audio_url"],
        "frame_count": result.get("frame_count", len(frames)),
        "timings": result["timings"],
    }

