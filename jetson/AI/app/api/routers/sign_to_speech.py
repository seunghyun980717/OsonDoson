from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.api.deps import get_container
from app.api.schemas import GlossRequest, SignToSpeechResponse
from app.container import RuntimeContainer
from app.services.sign_to_speech import SignToSpeechService
from core.config import CACHE_DIR

router = APIRouter(prefix="/sign-to-speech", tags=["sign-to-speech"])


@router.get("/samples")
def list_samples(prefix: str = "", limit: int = 50) -> dict[str, object]:
    if not CACHE_DIR.exists():
        return {"samples": [], "total": 0, "showing": 0}
    files = sorted(CACHE_DIR.glob("*.npy"))
    if prefix:
        files = [path for path in files if prefix.upper() in path.stem.upper()]
    names = [path.stem for path in files[:limit]]
    return {"samples": names, "total": len(files), "showing": len(names)}


@router.get("/samples/random")
def random_samples(n: int = Query(default=1, ge=1, le=10)) -> dict[str, object]:
    import random

    files = list(CACHE_DIR.glob("*.npy"))
    if not files:
        raise HTTPException(status_code=404, detail="No cached samples were found.")
    picks = random.sample(files, min(n, len(files)))
    return {"samples": [path.stem for path in picks]}


@router.post("/sample", response_model=SignToSpeechResponse)
def sample_to_speech(
    name: str = Query(default="NIA_SL_SEN0001_REAL01_F"),
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechResponse:
    service = SignToSpeechService(container)
    return SignToSpeechResponse(**service.sample_to_speech(name))


@router.post("/npy", response_model=SignToSpeechResponse)
def npy_to_speech(
    file: UploadFile = File(...),
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechResponse:
    service = SignToSpeechService(container)
    return SignToSpeechResponse(**service.npy_to_speech(file.file.read()))


@router.post("/gloss", response_model=SignToSpeechResponse)
def gloss_to_speech(
    payload: GlossRequest,
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechResponse:
    service = SignToSpeechService(container)
    return SignToSpeechResponse(**service.gloss_to_speech(payload.gloss))


@router.post("/video", response_model=SignToSpeechResponse)
def video_to_speech(
    file: UploadFile = File(...),
    visualize: bool = Query(default=False, description="키포인트 시각화 영상 생성 여부"),
    container: RuntimeContainer = Depends(get_container),
) -> SignToSpeechResponse:
    suffix = Path(file.filename or "input.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        shutil.copyfileobj(file.file, handle)
        tmp_path = Path(handle.name)
    try:
        service = SignToSpeechService(container)
        result = service.video_to_speech(tmp_path, visualize=visualize)
    finally:
        tmp_path.unlink(missing_ok=True)
    return SignToSpeechResponse(**result)

