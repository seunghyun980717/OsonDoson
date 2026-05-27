from __future__ import annotations

from dataclasses import dataclass
from fastapi import FastAPI

from app.ai_runtime.container import RuntimeContainer
from app.ai_runtime.services.sign_to_speech import SignToSpeechService
from app.ai_runtime.services.speech_to_sign import SpeechToSignService
from app.ai_runtime.settings import AppSettings


@dataclass
class AIRuntimeState:
    settings: AppSettings
    container: RuntimeContainer
    sign_to_speech: SignToSpeechService
    speech_to_sign: SpeechToSignService


def set_ai_runtime_state(app: FastAPI, state: AIRuntimeState) -> None:
    app.state.ai_runtime = state


def get_ai_runtime_state(app: FastAPI) -> AIRuntimeState:
    state = getattr(app.state, "ai_runtime", None)
    if state is None:
        raise RuntimeError("AI runtime state has not been initialized.")
    return state
