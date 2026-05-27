from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging

"""Fast API 앱의 시작점"""
from app.ai_runtime.container import RuntimeContainer
from app.ai_runtime.services.sign_to_speech import SignToSpeechService
from app.ai_runtime.services.speech_to_sign import SpeechToSignService
from app.ai_runtime.settings import load_settings
from app.ai_runtime.state import AIRuntimeState, set_ai_runtime_state
from app.routers import ws

bootstrap_settings = load_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

"""fast api 서버 생명주기 정의하는 함수"""
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = bootstrap_settings
    container = RuntimeContainer(settings)
    container.startup()

    # AI 관련 공용 객 만들기
    runtime_state = AIRuntimeState(
        settings=settings,
        container=container,
        sign_to_speech=SignToSpeechService(container),
        speech_to_sign=SpeechToSignService(container),
    )

    # 어디서든 app.state.ai_runtime_state 로 공용 객체 꺼낼 수 있게 하기
    set_ai_runtime_state(app, runtime_state)
    yield


"""서버 앱 만들기"""
app = FastAPI(
    title="Jetson WebSocket Backend",
    description="1:1 hearing/signer WebSocket skeleton with mock translation handlers.",
    version="0.1.0",
    lifespan=lifespan,
)

"""CORS 설정"""
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    bootstrap_settings.public_static_prefix,
    StaticFiles(directory=bootstrap_settings.static_dir),
    name="static",
)

"""
- /ws router 등록
- ws.py 에 있는 websocket 주소들을 /ws 아래에 붙인다
"""
app.include_router(ws.router, prefix="/ws", tags=["WebSocket"])


"""/health api 제공"""
@app.get("/health")
def health() -> dict:
    runtime_state = getattr(app.state, "ai_runtime", None)
    if runtime_state is None:
        return {"status": "initializing"}

    return {
        "status": "ok",
        "profile": runtime_state.settings.profile.name,
        "translation_backend": runtime_state.settings.translation_backend,
        "models": runtime_state.container.model_status(),
    }
