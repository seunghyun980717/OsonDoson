from __future__ import annotations

import asyncio
from typing import Any

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field


RESPONSE_DELAY_SECONDS = 2

SAMPLE_AUDIO_BYTES = b"ID3\x03\x00\x00\x00\x00\x00\x21TEST_MP3_PAYLOAD"
SAMPLE_AUDIO_NAME = "sample-sign2speech.mp3"
SAMPLE_AUDIO_URL = f"/static/audio/{SAMPLE_AUDIO_NAME}"

SAMPLE_KEYPOINT_NAME = "sample-speech2sign.json"
SAMPLE_KEYPOINT_URL = f"/static/json/{SAMPLE_KEYPOINT_NAME}"
SAMPLE_KEYPOINT_PATH = f"/app/static/json/{SAMPLE_KEYPOINT_NAME}"

SAMPLE_KEYPOINT_PAYLOAD: dict[str, Any] = {
    "version": "sign-sentence-keypoints/v1",
    "frames": [
        {
            "frame_index": 0,
            "pose": [{"x": 0.5, "y": 0.18, "z": 0.0}],
            "left_hand": [],
            "right_hand": [],
        },
        {
            "frame_index": 1,
            "pose": [{"x": 0.52, "y": 0.2, "z": 0.0}],
            "left_hand": [],
            "right_hand": [],
        },
    ],
}


class LandmarkRequest(BaseModel):
    x: float
    y: float
    z: float
    visibility: float | None = None


class MediaPipeFrameRequest(BaseModel):
    poseLandmarks: list[LandmarkRequest] = Field(default_factory=list)
    leftHandLandmarks: list[LandmarkRequest] = Field(default_factory=list)
    rightHandLandmarks: list[LandmarkRequest] = Field(default_factory=list)
    faceLandmarks: list[LandmarkRequest] = Field(default_factory=list)
    videoWidth: int | None = None
    videoHeight: int | None = None


class Sign2SpeechRequest(BaseModel):
    type: str
    frames: list[MediaPipeFrameRequest] = Field(default_factory=list)


class Speech2SignTextRequest(BaseModel):
    text: str


class AudioResponse(BaseModel):
    format: str
    content_type: str
    url: str


class Sign2SpeechResponse(BaseModel):
    type: str
    source: str
    glosses: list[str]
    korean: str
    audio_url: str
    audio: AudioResponse


class Speech2SignResponse(BaseModel):
    korean: str
    glosses: list[str]
    gloss_str: str
    keypoint_url: str
    keypoint_path: str
    keypoint_payload: dict[str, Any]
    resolved_glosses: list[str]
    missing_glosses: list[str]
    coverage: float
    timings: dict[str, float]


app = FastAPI(title="translation test client")


async def simulate_external_latency() -> None:
    await asyncio.sleep(RESPONSE_DELAY_SECONDS)


def build_speech2sign_response(korean: str, include_stt_timing: bool) -> Speech2SignResponse:
    glosses = ["화장실", "가다", "원하다"]
    timings = {"korean_to_gloss": 0.12}
    if include_stt_timing:
        timings = {"stt": 0.52, **timings}

    return Speech2SignResponse(
        korean=korean,
        glosses=glosses,
        gloss_str=" ".join(glosses),
        keypoint_url=SAMPLE_KEYPOINT_URL,
        keypoint_path=SAMPLE_KEYPOINT_PATH,
        keypoint_payload=SAMPLE_KEYPOINT_PAYLOAD,
        resolved_glosses=[],
        missing_glosses=glosses,
        coverage=0.0,
        timings=timings,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/static/audio/{file_name}")
async def get_audio_asset(file_name: str) -> Response:
    if file_name != SAMPLE_AUDIO_NAME:
        return Response(status_code=404)

    return Response(
        content=SAMPLE_AUDIO_BYTES,
        media_type="audio/mpeg",
        headers={"Content-Length": str(len(SAMPLE_AUDIO_BYTES))},
    )


@app.get("/static/json/{file_name}")
async def get_keypoint_asset(file_name: str) -> dict[str, Any]:
    if file_name != SAMPLE_KEYPOINT_NAME:
        raise HTTPException(status_code=404, detail="keypoint asset not found")

    return SAMPLE_KEYPOINT_PAYLOAD


@app.post("/sign2speech", response_model=Sign2SpeechResponse)
async def sign2speech(request: Sign2SpeechRequest) -> Sign2SpeechResponse:
    frame_count = len(request.frames)

    # Spring server의 외부 API 대기 흐름을 확인하기 쉽도록 응답을 지연한다.
    await simulate_external_latency()

    glosses = ["테스트", "수어"]
    korean = f"테스트 응답입니다. type={request.type}, frames={frame_count}"

    return Sign2SpeechResponse(
        type="sign_to_speech_result",
        source="signer",
        glosses=glosses,
        korean=korean,
        audio_url=SAMPLE_AUDIO_URL,
        audio=AudioResponse(
            format="mp3",
            content_type="audio/mpeg",
            url=SAMPLE_AUDIO_URL,
        ),
    )


@app.post("/speech-to-sign/audio", response_model=Speech2SignResponse)
async def speech2sign_audio(file: UploadFile = File(...)) -> Speech2SignResponse:
    await file.read()
    await simulate_external_latency()

    korean = f"더미 STT 결과입니다. file={file.filename or 'unknown'}"
    return build_speech2sign_response(korean=korean, include_stt_timing=True)


@app.post("/speech-to-sign/text/keypoints", response_model=Speech2SignResponse)
async def speech2sign_text(payload: Speech2SignTextRequest) -> Speech2SignResponse:
    await simulate_external_latency()

    korean = payload.text.strip() or "빈 텍스트"
    return build_speech2sign_response(korean=korean, include_stt_timing=False)
