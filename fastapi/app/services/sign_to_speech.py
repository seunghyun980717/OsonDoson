from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Any

import numpy as np
import torch

from app.container import RuntimeContainer
from app.services.exceptions import (
    FrameInputEmptyError,
    GlossInputEmptyError,
    GlossSequenceGenerationError,
    KeypointInputEmptyError,
    KeypointShapeInvalidError,
    NpyPayloadParseError,
    SampleNotFoundError,
    TranslationFailedError,
)
from app.services.timing import PipelineTimer
from core.config import CACHE_DIR

logger = logging.getLogger(__name__)


class SignToSpeechService:
    def __init__(self, container: RuntimeContainer):
        self.container = container

    def sample_to_speech(self, name: str) -> dict[str, Any]:
        npy_path = CACHE_DIR / f"{name}.npy"
        if not npy_path.exists():
            available = [path.stem for path in sorted(CACHE_DIR.glob("*.npy"))[:5]]
            logger.warning("sample_to_speech에서 요청한 샘플을 찾지 못했습니다. name=%s", name)
            raise SampleNotFoundError(f"요청한 샘플을 찾지 못했습니다. 예시: {available}")
        keypoints = np.load(npy_path)
        result = self._keypoints_to_speech(keypoints, pipeline_name=f"sign_to_speech.sample.{name}")
        label = self.container.label_index.get(name)
        result["label"] = label
        result["label_match"] = bool(label and result["gloss"].strip() == label.strip())
        return result

    def npy_to_speech(self, raw_bytes: bytes) -> dict[str, Any]:
        try:
            keypoints = np.load(io.BytesIO(raw_bytes))
        except Exception as exc:
            logger.warning("npy_to_speech에서 npy payload 파싱에 실패했습니다. error=%s", exc)
            raise NpyPayloadParseError(f"npy payload를 파싱하지 못했습니다. error={exc}") from exc
        return self._keypoints_to_speech(keypoints, pipeline_name="sign_to_speech.npy")

    ## gloss -> audio
    def gloss_to_speech(self, gloss: str) -> dict[str, Any]:
        logger.info("gloss_to_speech 처리를 시작합.")

        ## 들어온 gloss 문자열이 비어있는지 확인
        if not gloss.strip():
            logger.warning("gloss_to_speech에서 빈 gloss 입력이 감지.")
            raise GlossInputEmptyError("gloss 입력이 비어 있습니다.")
        
        ## 단계별 소요 시간을 모으기 위한 객체 생성
        timer = PipelineTimer("sign_to_speech.gloss")

        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)
        audio_url = None
        with timer.step("tts"):
            audio_url = self._synthesize_audio(korean)
        logger.info("gloss_to_speech 처리가 완료. audio_url 생성 여부=%s", bool(audio_url))
        return {
            "gloss": gloss,
            "korean": korean,
            "audio_url": audio_url,
            "audio_path": None,
            "timings": timer.finish(),
            "label": None,
            "label_match": None,
        }

    def video_to_speech(self, video_path: Path) -> dict[str, Any]:
        timer = PipelineTimer("sign_to_speech.video")
        with timer.step("video_to_keypoints"):
            from core.data_utils.video_to_keypoints import video_to_keypoints

            keypoints = video_to_keypoints(video_path)
        return self._keypoints_to_speech(keypoints, timer=timer)

    def frames_to_speech(self, frames: list[dict]) -> dict[str, Any]:
        logger.info("frames_to_speech 처리를 시작합니다. frame 수=%s", len(frames))
        if not frames:
            logger.warning("frames_to_speech에서 빈 frame 리스트가 감지되었습니다.")
            raise FrameInputEmptyError()
        timer = PipelineTimer("sign_to_speech.frames")
        with timer.step("frame_normalize"):
            from core.data_utils.mediapipe_converter import frames_to_sequence_v2

            try:
                # sign-v2: 150차원 전용 변환기 및 어깨 정규화 사용
                keypoints = frames_to_sequence_v2(frames)
            except Exception:
                logger.exception("frames_to_speech의 frame 정규화 단계에서 오류가 발생했습니다.")
                raise
        result = self._keypoints_to_speech(keypoints, timer=timer)
        result["frame_count"] = len(frames)
        logger.info("frames_to_speech 처리가 완료되었습니다. gloss=%s", result.get("gloss"))
        return result

    def _keypoints_to_speech(
        self,
        keypoints: np.ndarray | None,
        *,
        pipeline_name: str | None = None,
        timer: PipelineTimer | None = None,
    ) -> dict[str, Any]:
        if keypoints is None or len(keypoints) == 0:
            logger.warning("keypoints_to_speech에서 빈 keypoint 데이터가 감지되었습니다.")
            raise KeypointInputEmptyError()
        
        # sign-v2: 150차원 규격 검증
        if keypoints.ndim != 2 or keypoints.shape[1] != 150:
            logger.warning("keypoints_to_speech에서 예상하지 못한 keypoint shape가 감지되었습니다. shape=%s", keypoints.shape)
            raise KeypointShapeInvalidError(f"keypoint 데이터 형식이 올바르지 않습니다. shape={keypoints.shape}")

        timer = timer or PipelineTimer(pipeline_name or "sign_to_speech.keypoints")

        with timer.step("ctc_inference"):
            gloss = self._ctc_infer(keypoints)
        if not gloss:
            logger.warning("ctc_inference 단계에서 빈 gloss 시퀀스가 반환.")
            raise GlossSequenceGenerationError()

        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)

        # tts
        audio_url = None
        with timer.step("tts"):
            audio_url = self._synthesize_audio(korean)

        return {
            "gloss": gloss,
            "korean": korean,
            "audio_url": audio_url,
            "audio_path": None,
            "timings": timer.finish(),
            "label": None,
            "label_match": None,
        }

    def _ctc_infer(self, keypoints: np.ndarray) -> str:
        from core.sign_to_speech.model import ctc_greedy_decode

        model, vocab = self.container.get_ctc_model()
        device = next(model.parameters()).device
        tensor = torch.from_numpy(keypoints).float().unsqueeze(0).to(device)
        lengths = torch.tensor([tensor.shape[1]], dtype=torch.long, device=device)
        with torch.no_grad():
            log_probs, _ = model(tensor, lengths=lengths)
        return ctc_greedy_decode(log_probs, vocab)[0]

    def _translate_gloss(self, gloss: str) -> str:

        # container 번역기 리소스 미리 준비
        self.container.get_translator()
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean

        # 실제 글로스 -> 평문 번역 
        try:
            korean = gloss_to_korean(gloss)
        except Exception:
            logger.exception("gloss_to_korean 호출 중 오류가 발생. gloss=%s", gloss)
            raise

        # 평문이 비어있으면 예외
        if not korean:
            logger.warning("gloss_to_korean 단계에서 빈 평문이 반환. gloss=%s", gloss)
            raise TranslationFailedError("gloss를 평문으로 번역하지 못했습니다.")
        return korean

    def _synthesize_audio(self, korean: str) -> str | None:
        if not self.container.settings.enable_tts:
            return None
        from runtime.sign_to_speech.tts import speak

        audio_path = self.container.new_audio_path()
        try:
            result = speak(korean, output_path=audio_path, play=False)
        except Exception as exc:
            logger.warning("TTS 음성 합성 중 오류가 발생. error=%s", exc)
            return None
        if result is None or not audio_path.exists():
            logger.warning("TTS 결과 오디오 파일이 생성되지 않음. text=%s", korean)
            return None
        return self.container.to_public_url(audio_path)
