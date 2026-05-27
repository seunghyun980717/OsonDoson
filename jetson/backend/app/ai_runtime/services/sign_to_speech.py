from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import torch

from app.ai_runtime.container import RuntimeContainer
from app.ai_runtime.services.timing import PipelineTimer
from app.ai_runtime.services.exceptions import PipelineStageError
from app.ai_runtime.core.config import CACHE_DIR


class SignToSpeechService:
    def __init__(self, container: RuntimeContainer):
        self.container = container

    def sample_to_speech(self, name: str) -> dict[str, Any]:
        npy_path = CACHE_DIR / f"{name}.npy"
        if not npy_path.exists():
            available = [path.stem for path in sorted(CACHE_DIR.glob("*.npy"))[:5]]
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="sample_lookup",
                message=f"Sample '{name}' was not found. Examples: {available}",
                status_code=404,
            )
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
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="npy_parse",
                message=_describe_exception(exc, "Failed to parse npy payload."),
                status_code=422,
            ) from exc
        return self._keypoints_to_speech(keypoints, pipeline_name="sign_to_speech.npy")

    def gloss_to_speech(self, gloss: str) -> dict[str, Any]:
        if not gloss.strip():
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="input_validation",
                message="Gloss input is empty.",
                status_code=422,
            )
        timer = PipelineTimer("sign_to_speech.gloss")
        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)
        audio_url = None
        audio_path = None
        with timer.step("tts"):
            audio_path, audio_url = self._synthesize_audio(korean)
        return {
            "gloss": gloss,
            "korean": korean,
            "audio_url": audio_url,
            "audio_path": str(audio_path) if audio_path is not None else None,
            "timings": timer.finish(),
            "label": None,
            "label_match": None,
        }

    def video_to_speech(self, video_path: Path) -> dict[str, Any]:
        timer = PipelineTimer("sign_to_speech.video")
        with timer.step("video_to_keypoints"):
            try:
                from app.ai_runtime.core.data_utils.video_to_keypoints import video_to_keypoints

                keypoints = video_to_keypoints(video_path)
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="sign_to_speech",
                    stage="video_to_keypoints",
                    message=_describe_exception(exc, "Failed to extract keypoints from video."),
                    status_code=500,
                ) from exc
        return self._keypoints_to_speech(keypoints, timer=timer)

    def frames_to_speech(self, frames: list[dict]) -> dict[str, Any]:
        if not frames:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="input_validation",
                message="No frames were provided.",
                status_code=400,
            )
        timer = PipelineTimer("sign_to_speech.frames")
        with timer.step("frame_normalize"):
            try:
                from app.ai_runtime.runtime.sign_to_speech.mediapipe_converter import frames_to_sequence_v2

                keypoints = frames_to_sequence_v2(frames)
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="sign_to_speech",
                    stage="frame_normalize",
                    message=_describe_exception(exc, "Failed to normalize signer frames."),
                    status_code=500,
                ) from exc
        result = self._keypoints_to_speech(keypoints, timer=timer)
        result["frame_count"] = len(frames)
        return result

    def _keypoints_to_speech(
        self,
        keypoints: np.ndarray | None,
        *,
        pipeline_name: str | None = None,
        timer: PipelineTimer | None = None,
    ) -> dict[str, Any]:
        if keypoints is None or len(keypoints) == 0:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="keypoint_validation",
                message="No keypoints were extracted.",
                status_code=422,
            )
        if keypoints.ndim != 2 or keypoints.shape[1] != 150:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="keypoint_validation",
                message=f"Unexpected keypoint shape: {keypoints.shape}",
                status_code=422,
            )

        timer = timer or PipelineTimer(pipeline_name or "sign_to_speech.keypoints")

        with timer.step("ctc_inference"):
            gloss = self._ctc_infer(keypoints)
        if not gloss:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="ctc_inference",
                message="CTC inference returned an empty gloss sequence.",
                status_code=422,
            )

        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)

        audio_url = None
        audio_path = None
        with timer.step("tts"):
            audio_path, audio_url = self._synthesize_audio(korean)

        return {
            "gloss": gloss,
            "korean": korean,
            "audio_url": audio_url,
            "audio_path": str(audio_path) if audio_path is not None else None,
            "timings": timer.finish(),
            "label": None,
            "label_match": None,
        }

    def _ctc_infer(self, keypoints: np.ndarray) -> str:
        from app.ai_runtime.core.sign_to_speech.model import ctc_greedy_decode

        model, vocab = self.container.get_ctc_model()
        device = next(model.parameters()).device
        tensor = torch.from_numpy(keypoints).float().unsqueeze(0).to(device)
        lengths = torch.tensor([tensor.shape[1]], dtype=torch.long, device=device)
        with torch.no_grad():
            log_probs, _ = model(tensor, lengths=lengths)
        return ctc_greedy_decode(log_probs, vocab)[0]

    def _translate_gloss(self, gloss: str) -> str:
        self.container.get_translator()
        from app.ai_runtime.runtime.sign_to_speech.gloss_to_korean import gloss_to_korean

        try:
            korean = gloss_to_korean(gloss)
        except PipelineStageError:
            raise
        except Exception as exc:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="gloss_to_korean",
                message=_describe_exception(exc, "Failed to translate gloss into Korean."),
                status_code=500,
            ) from exc
        if not korean:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="gloss_to_korean",
                message="Failed to translate gloss into Korean.",
                status_code=422,
            )
        return korean

    def _synthesize_audio(self, korean: str) -> tuple[Path | None, str | None]:
        if not self.container.settings.enable_tts:
            return None, None
        from app.ai_runtime.runtime.sign_to_speech.tts import speak

        audio_path = self.container.new_audio_path()
        try:
            result = speak(korean, output_path=audio_path, play=False)
        except Exception as exc:
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="tts",
                message=_describe_exception(exc, "Audio synthesis failed."),
                status_code=500,
            ) from exc
        if result is None or not audio_path.exists():
            raise PipelineStageError(
                pipeline="sign_to_speech",
                stage="tts",
                message="Audio synthesis finished without creating an output file.",
                status_code=500,
            )
        return audio_path, self.container.to_public_url(audio_path)


def _describe_exception(exc: Exception, default_message: str) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, str) and detail.strip():
        return detail.strip()

    message = str(exc).strip()
    if message:
        return message

    return default_message
