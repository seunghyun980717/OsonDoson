from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.api.schemas import HealthResponse
from app.container import RuntimeContainer

router = APIRouter()


@router.get("/", include_in_schema=False)
def root(container: RuntimeContainer = Depends(get_container)) -> dict[str, str]:
    return {
        "message": "LKS MVP API",
        "profile": container.settings.profile.name,
        "docs": "/docs",
        "health": "/health",
    }


@router.get("/health", response_model=HealthResponse)
def health(container: RuntimeContainer = Depends(get_container)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        profile=container.settings.profile.name,
        translation_backend=container.settings.translation_backend,
        device=container.device_info,
        models=container.model_status(),
        artifact_root=str(container.settings.static_dir),
    )

