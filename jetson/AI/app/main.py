from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routers import health, inference, sign_to_speech, speech_to_sign
from app.container import RuntimeContainer
from app.settings import load_settings


def build_container() -> RuntimeContainer:
    return RuntimeContainer(settings=load_settings())


def create_app() -> FastAPI:
    container = build_container()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        container.startup()
        yield

    app = FastAPI(
        title=container.settings.app_name,
        version="0.1.0",
        description="RunPod-ready MVP API for sign-to-speech and speech-to-sign.",
        lifespan=lifespan,
    )
    app.state.container = container
    app.mount(container.settings.public_static_prefix, StaticFiles(directory=container.settings.static_dir), name="static")
    app.include_router(health.router)
    app.include_router(speech_to_sign.router)
    app.include_router(sign_to_speech.router)
    app.include_router(inference.router)
    return app


app = create_app()

