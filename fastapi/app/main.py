from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.exception_handlers import register_exception_handlers
from app.api.routers import translation
from app.container import RuntimeContainer
from app.settings import load_settings

logging.basicConfig(level=logging.INFO)


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
    register_exception_handlers(app)
    app.mount(container.settings.public_static_prefix, StaticFiles(directory=container.settings.static_dir), name="static")
    app.include_router(translation.router)
    return app


app = create_app()
