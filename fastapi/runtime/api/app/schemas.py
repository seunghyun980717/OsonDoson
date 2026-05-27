from pydantic import BaseModel
from typing import List, Optional


# ── Speech-to-Sign ────────────────────────────────────────────────────────

class TextRequest(BaseModel):
    text: str


class SpeechToSignResponse(BaseModel):
    korean:     str
    glosses:    List[str]
    gloss_str:  str
    video_path: Optional[str]
    timings:    dict


# ── Sign-to-Speech ────────────────────────────────────────────────────────

class GlossRequest(BaseModel):
    gloss: str


class KeypointsRequest(BaseModel):
    """(T, 134) 정규화 완료된 keypoint 시퀀스. 테스트용."""
    keypoints: List[List[float]]  # shape (T, 134)


class SignToSpeechResponse(BaseModel):
    gloss:       str
    korean:      str
    audio_path:  Optional[str]
    timings:     dict
    # 샘플 테스트 시 추가 (일반 요청은 None)
    label:       Optional[str] = None   # CSV 정답 글로스
    label_match: Optional[bool] = None  # 예측 == 정답 여부


# ── 공통 ─────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:     str
    retriever:  bool
    translator: bool
    word_db:    int
    stt:        bool
