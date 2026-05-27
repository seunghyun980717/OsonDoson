from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from core.config import LKS_DIR, TRANSLATION_BACKEND, get_active_word_db_path


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class RuntimeProfile:
    name: str
    preload_models: bool
    enable_tts: bool
    enable_stt: bool
    description: str


PROFILES: dict[str, RuntimeProfile] = {
    "local": RuntimeProfile(
        name="local",
        preload_models=False,
        enable_tts=True,
        enable_stt=True,
        description="Local development with lazy model loading.",
    ),
    "runpod": RuntimeProfile(
        name="runpod",
        preload_models=True,
        enable_tts=True,
        enable_stt=True,
        description="Server deployment profile for RunPod.",
    ),
    "jetson": RuntimeProfile(
        name="jetson",
        preload_models=False,
        enable_tts=True,
        enable_stt=True,
        description="On-device profile for Jetson Orin Nano.",
    ),
}


@dataclass
class AppSettings:
    profile: RuntimeProfile
    host: str = field(default_factory=lambda: os.getenv("LKS_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("LKS_PORT", "8000")))
    app_name: str = field(default_factory=lambda: os.getenv("LKS_APP_NAME", "LKS MVP API"))
    translation_backend: str = field(default_factory=lambda: os.getenv("LKS_TRANSLATION_BACKEND", TRANSLATION_BACKEND))
    public_static_prefix: str = field(default_factory=lambda: os.getenv("LKS_STATIC_PREFIX", "/static"))
    static_dir: Path = field(default_factory=lambda: LKS_DIR / "app" / "static")
    word_db_path: Path = field(default_factory=get_active_word_db_path)
    preload_models: bool = field(init=False)
    enable_tts: bool = field(init=False)
    enable_stt: bool = field(init=False)
    audio_dir: Path = field(init=False)
    video_dir: Path = field(init=False)
    json_dir: Path = field(init=False)

    def __post_init__(self) -> None:
        self.preload_models = _env_flag("LKS_PRELOAD_MODELS", self.profile.preload_models)
        self.enable_tts = _env_flag("LKS_ENABLE_TTS", self.profile.enable_tts)
        self.enable_stt = _env_flag("LKS_ENABLE_STT", self.profile.enable_stt)
        self.audio_dir = self.static_dir / "audio"
        self.video_dir = self.static_dir / "video"
        self.json_dir = self.static_dir / "json"
        self.static_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.video_dir.mkdir(parents=True, exist_ok=True)
        self.json_dir.mkdir(parents=True, exist_ok=True)


def load_settings() -> AppSettings:
    profile_name = os.getenv("LKS_PROFILE", "local").strip().lower()
    profile = PROFILES.get(profile_name, PROFILES["local"])
    return AppSettings(profile=profile)
