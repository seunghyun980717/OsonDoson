from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1)


class GlossRequest(BaseModel):
    gloss: str = Field(..., min_length=1)


class SpeechToSignResponse(BaseModel):
    korean: str
    glosses: list[str]
    gloss_str: str
    video_url: str | None = None
    video_path: str | None = None
    resolved_glosses: list[str] = Field(default_factory=list)
    missing_glosses: list[str] = Field(default_factory=list)
    coverage: float = 0.0
    timings: dict[str, float]


class SpeechToSignKeypointResponse(BaseModel):
    korean: str
    glosses: list[str]
    gloss_str: str
    keypoint_url: str | None = None
    keypoint_path: str | None = None
    keypoint_payload: dict[str, Any] = Field(default_factory=dict)
    resolved_glosses: list[str] = Field(default_factory=list)
    missing_glosses: list[str] = Field(default_factory=list)
    coverage: float = 0.0
    timings: dict[str, float]


class SignToSpeechResponse(BaseModel):
    gloss: str
    korean: str
    audio_url: str | None = None
    audio_path: str | None = None
    visualize_url: str | None = None
    timings: dict[str, float]
    label: str | None = None
    label_match: bool | None = None


class HealthResponse(BaseModel):
    status: str
    profile: str
    translation_backend: str
    device: dict[str, Any] | None = None
    models: dict[str, Any]
    artifact_root: str

