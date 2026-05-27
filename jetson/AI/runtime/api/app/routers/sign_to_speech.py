"""
Sign-to-Speech 라우터

전체 파이프라인 (Python 단독):
  영상 업로드 → MediaPipe keypoint 추출 → CTC 추론 → 한국어 → TTS → 음성 URL

엔드포인트:
  POST /sign-to-speech/video   — 수어 영상 파일 → 전체 파이프라인 (메인)
  POST /sign-to-speech/npy     — .npy 파일 → CTC부터 (Swagger/테스트용)
  POST /sign-to-speech/gloss   — 글로스 문자열 → 한국어 → TTS
"""
import io
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
import torch
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from core.config import CACHE_DIR
from runtime.api.app.schemas import GlossRequest, SignToSpeechResponse
from runtime.api.app.state  import state
from runtime.api.app.timer  import PipelineTimer

router = APIRouter()

# TTS 음성 저장 위치 (static 서빙 → 클라이언트에서 URL로 재생)
AUDIO_DIR = Path(__file__).parent.parent / "static" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


# ── 공통 헬퍼 ─────────────────────────────────────────────────────────────────

def _ctc_infer(keypoints: np.ndarray) -> str:
    """(T, 134) → 글로스 문자열. state.ctc_model 사용."""
    from runtime.sign_to_speech.infer import ctc_decode

    model = state.ctc_model
    vocab = state.ctc_vocab
    if model is None or vocab is None:
        raise HTTPException(status_code=503, detail="CTC 모델 미로드 (checkpoints/best.pt 필요)")

    device = next(model.parameters()).device
    x = torch.from_numpy(keypoints).float().unsqueeze(0).to(device)   # (1, T, 134)
    with torch.no_grad():
        log_probs, _ = model(x)
    return ctc_decode(log_probs, vocab)


def _tts(korean: str) -> str | None:
    """한국어 → TTS 저장 후 /static/audio/<ts>.mp3 URL 반환."""
    from runtime.sign_to_speech.tts import speak

    audio_file = AUDIO_DIR / f"{int(time.time() * 1000)}.mp3"
    result = speak(korean, output_path=audio_file, play=False)
    if result and audio_file.exists():
        return f"/static/audio/{audio_file.name}"
    return None


def _make_response(gloss: str, korean: str, audio_url: str | None,
                   timings: dict) -> SignToSpeechResponse:
    return SignToSpeechResponse(
        gloss=gloss,
        korean=korean,
        audio_path=audio_url,
        timings=timings,
    )


# ── POST /video  (메인 엔드포인트) ────────────────────────────────────────────

@router.post("/video", response_model=SignToSpeechResponse,
             summary="수어 영상 → 글로스 → 한국어 → 음성 (전체 파이프라인)")
def video_to_speech(file: UploadFile = File(..., description="수어 영상 파일 (.mp4 등)")):
    """
    전체 파이프라인:
    영상 → MediaPipe keypoint 추출 → CTC 추론 → 한국어 → TTS

    반환값의 audio_path는 /static/audio/*.mp3 URL — 브라우저에서 바로 재생 가능.
    """
    timer = PipelineTimer("Sign-to-Speech / video")

    suffix = Path(file.filename).suffix if file.filename else ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        # 1. MediaPipe keypoint 추출
        with timer.step("keypoint 추출 (MediaPipe)"):
            from core.data_utils.video_to_keypoints import video_to_keypoints
            keypoints = video_to_keypoints(tmp_path)  # (T, 134) 정규화 완료

        if keypoints is None or len(keypoints) == 0:
            raise HTTPException(
                status_code=422,
                detail="pose 검출 실패 — 영상에서 사람을 찾을 수 없습니다",
            )
        print(f"    → {len(keypoints)} frames")

        # 2. CTC 추론
        with timer.step("CTC 추론"):
            gloss_str = _ctc_infer(keypoints)

        if not gloss_str:
            raise HTTPException(status_code=422, detail="CTC 추론 결과 없음 (학습 더 필요)")
        print(f"    → 글로스: {gloss_str!r}")

        # 3. 글로스 → 한국어
        with timer.step("글로스→한국어 (T5)"):
            from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
            korean = gloss_to_korean(gloss_str)
        print(f"    → 한국어: {korean!r}")

        # 4. TTS
        with timer.step("TTS"):
            audio_url = _tts(korean)

        return _make_response(gloss_str, korean, audio_url, timer.finish())

    finally:
        tmp_path.unlink(missing_ok=True)


# ── POST /npy  (Swagger / 빠른 테스트용) ─────────────────────────────────────

@router.post("/npy", response_model=SignToSpeechResponse,
             summary="npy 파일 업로드 → CTC부터 실행 (Swagger 테스트용)")
def npy_to_speech(file: UploadFile = File(..., description="cache/*.npy (T, 134)")):
    """
    .npy 파일 업로드 → CTC 추론 → 한국어 → TTS.
    MediaPipe 없이 캐시된 keypoint로 CTC 이후 파이프라인만 빠르게 테스트.
    """
    timer = PipelineTimer("Sign-to-Speech / npy")

    raw = file.file.read()
    try:
        kp = np.load(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"npy 파싱 실패: {e}")

    if kp.ndim != 2 or kp.shape[1] != 134:
        raise HTTPException(
            status_code=422,
            detail=f"shape 오류: {kp.shape} — (T, 134) 이어야 합니다",
        )
    print(f"    → {kp.shape[0]} frames")

    with timer.step("CTC 추론"):
        gloss_str = _ctc_infer(kp)

    if not gloss_str:
        raise HTTPException(status_code=422, detail="CTC 추론 결과 없음")
    print(f"    → 글로스: {gloss_str!r}")

    with timer.step("글로스→한국어 (T5)"):
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
        korean = gloss_to_korean(gloss_str)
    print(f"    → 한국어: {korean!r}")

    with timer.step("TTS"):
        audio_url = _tts(korean)

    return _make_response(gloss_str, korean, audio_url, timer.finish())


# ── POST /gloss  (텍스트 직접 입력) ──────────────────────────────────────────

@router.get("/samples", summary="캐시된 데이터셋 샘플 목록 조회")
def list_samples(prefix: str = "", limit: int = 50):
    """
    cache/*.npy 파일 목록 반환.
    - prefix: 이름 필터 (예: 'SEN01', 'SEN05')
    - limit:  최대 반환 수 (기본 50)

    반환된 name을 POST /sign-to-speech/sample 의 name 파라미터에 그대로 사용.
    """
    if not CACHE_DIR.exists():
        return {"samples": [], "total": 0, "message": "cache/ 폴더 없음 — precache 먼저 실행"}

    files = sorted(CACHE_DIR.glob("*.npy"))
    if prefix:
        files = [f for f in files if prefix.upper() in f.stem.upper()]

    names = [f.stem for f in files[:limit]]
    return {
        "samples": names,
        "total":   len(files),
        "showing": len(names),
        "tip":     "name 값을 복사해서 POST /sign-to-speech/sample 에 입력하세요",
    }


@router.post("/sample", response_model=SignToSpeechResponse,
             summary="데이터셋 샘플 이름으로 추론 (파일 업로드 불필요)")
def sample_to_speech(
    name: str = "NIA_SL_SEN0001_REAL01_F",
):
    """
    cache/{name}.npy 를 로드해서 CTC → 한국어 → TTS 실행.

    **사용법**:
    1. GET /sign-to-speech/samples 로 목록 확인
    2. name 복사 후 여기에 붙여넣기 → Execute

    zip 압축 해제나 파일 업로드 없이 데이터셋 샘플로 바로 테스트 가능.
    """
    timer = PipelineTimer(f"Sign-to-Speech / sample ({name})")

    npy_path = CACHE_DIR / f"{name}.npy"
    if not npy_path.exists():
        available = [f.stem for f in sorted(CACHE_DIR.glob("*.npy"))[:5]]
        raise HTTPException(
            status_code=404,
            detail=f"'{name}.npy' 없음. 예시: {available}",
        )

    kp = np.load(npy_path)
    print(f"    → {name}  shape={kp.shape}")

    with timer.step("CTC 추론"):
        gloss_str = _ctc_infer(kp)

    if not gloss_str:
        raise HTTPException(status_code=422, detail="CTC 추론 결과 없음")
    print(f"    → 글로스: {gloss_str!r}")

    with timer.step("글로스→한국어 (T5)"):
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
        korean = gloss_to_korean(gloss_str)
    print(f"    → 한국어: {korean!r}")

    with timer.step("TTS"):
        audio_url = _tts(korean)

    # 정답 레이블 조회
    label = state.label_index.get(name) if state.label_index else None
    match = (gloss_str.strip() == label.strip()) if label else None

    if label:
        print(f"    → 정답: {label!r}  {'✓ 일치' if match else '✗ 불일치'}")

    resp = _make_response(gloss_str, korean, audio_url, timer.finish())
    resp.label       = label
    resp.label_match = match
    return resp


@router.get("/samples/random", summary="랜덤 샘플 추론")
def random_sample(n: int = 1):
    """
    cache/*.npy 에서 n개 랜덤 선택 → 추론 결과 반환.
    빠른 모델 점검용.
    """
    import random

    if not CACHE_DIR.exists():
        raise HTTPException(status_code=404, detail="cache/ 없음")

    files = list(CACHE_DIR.glob("*.npy"))
    if not files:
        raise HTTPException(status_code=404, detail="npy 파일 없음")

    from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean

    picks = random.sample(files, min(n, len(files)))
    results = []
    for p in picks:
        kp    = np.load(p)
        gloss = _ctc_infer(kp)
        korean = gloss_to_korean(gloss) if gloss else ""
        label  = state.label_index.get(p.stem) if state.label_index else None
        match  = (gloss.strip() == label.strip()) if label else None
        results.append({
            "name":        p.stem,
            "frames":      kp.shape[0],
            "gloss":       gloss,
            "label":       label,
            "label_match": match,
            "korean":      korean,
        })

    return {"results": results}


@router.post("/gloss", response_model=SignToSpeechResponse,
             summary="글로스 문자열 → 한국어 → TTS")
def gloss_to_speech(req: GlossRequest):
    """글로스 시퀀스 직접 입력 → 한국어 변환 → TTS."""
    timer = PipelineTimer("Sign-to-Speech / gloss")

    with timer.step("글로스→한국어 (T5)"):
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean
        korean = gloss_to_korean(req.gloss)

    if not korean:
        raise HTTPException(status_code=422, detail="한국어 변환 결과 없음")
    print(f"    → {korean!r}")

    with timer.step("TTS"):
        audio_url = _tts(korean)

    return _make_response(req.gloss, korean, audio_url, timer.finish())
