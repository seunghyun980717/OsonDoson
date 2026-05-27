"""
Speech-to-Sign 라우터

POST /speech-to-sign/text   — 텍스트 → 글로스 → 수어 영상
POST /speech-to-sign/audio  — 음성 파일 → STT → 글로스 → 수어 영상
"""
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from core.config import OUTPUTS_DIR
from runtime.api.app.schemas import TextRequest, SpeechToSignResponse
from runtime.api.app.state  import state
from runtime.api.app.timer  import PipelineTimer

router = APIRouter()

OUTPUT_VIDEO = OUTPUTS_DIR / "output_sign.mp4"


def _run_pipeline(korean: str, timer: PipelineTimer) -> SpeechToSignResponse:
    from runtime.speech_to_sign.korean_to_gloss import korean_to_gloss
    from runtime.speech_to_sign.gloss_to_video  import glosses_to_video

    with timer.step("글로스 변환"):
        glosses = korean_to_gloss(korean, retriever=state.retriever)

    if not glosses:
        raise HTTPException(status_code=422, detail="글로스 변환 결과 없음")

    print(f"    → {' '.join(glosses)}")

    with timer.step("영상 생성"):
        video_path = glosses_to_video(glosses, output=OUTPUT_VIDEO, word_db=state.word_db)

    timings = timer.finish()

    return SpeechToSignResponse(
        korean=korean,
        glosses=glosses,
        gloss_str=" ".join(glosses),
        video_path=str(video_path) if video_path else None,
        timings=timings,
    )


@router.post("/text", response_model=SpeechToSignResponse)
def text_to_sign(req: TextRequest):
    """텍스트 → 글로스 → 수어 영상"""
    timer = PipelineTimer("Speech-to-Sign / text")
    return _run_pipeline(req.text, timer)


@router.post("/audio", response_model=SpeechToSignResponse)
def audio_to_sign(file: UploadFile = File(...)):
    """음성 파일 → STT → 글로스 → 수어 영상"""
    timer = PipelineTimer("Speech-to-Sign / audio")

    # 임시 파일로 저장
    suffix = Path(file.filename).suffix if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        with timer.step("STT"):
            from runtime.speech_to_sign.stt import load_model, transcribe_file
            if state.stt_model is None:
                state.stt_model = load_model("small")
            korean = transcribe_file(tmp_path, model=state.stt_model)
        print(f"    → {korean}")
        return _run_pipeline(korean, timer)
    finally:
        tmp_path.unlink(missing_ok=True)
