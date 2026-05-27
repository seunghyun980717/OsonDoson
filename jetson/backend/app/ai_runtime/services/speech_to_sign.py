from __future__ import annotations

import json
import logging
from pathlib import Path

from app.ai_runtime.container import RuntimeContainer
from app.ai_runtime.services.exceptions import PipelineStageError
from app.ai_runtime.services.timing import PipelineTimer

logger = logging.getLogger(__name__)


class SpeechToSignService:
    def __init__(self, container: RuntimeContainer):
        self.container = container

    def text_to_sign(self, text: str) -> dict:
        timer = PipelineTimer("speech_to_sign.text")
        return self._run_pipeline(text, timer)

    def text_to_keypoints(self, text: str) -> dict:
        timer = PipelineTimer("speech_to_sign.text.keypoints")
        return self._run_keypoint_pipeline(text, timer)

    def audio_to_sign(self, audio_path: Path) -> dict:
        timer = PipelineTimer("speech_to_sign.audio")
        with timer.step("stt"):
            try:
                from app.ai_runtime.runtime.speech_to_sign.stt import transcribe_file

                korean = transcribe_file(audio_path, model=self.container.get_stt_model())
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="stt",
                    message=_describe_exception(exc, "Speech-to-text transcription failed."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress("speech_to_sign.audio", "stt", timer, audio_path=str(audio_path))
        result = self._run_pipeline(korean, timer)
        result["source_audio"] = str(audio_path)
        return result

    def _run_pipeline(self, korean: str, timer: PipelineTimer) -> dict:
        from app.ai_runtime.runtime.speech_to_sign.gloss_to_video import collect_gloss_segments, glosses_to_video, load_jamo_db
        from app.ai_runtime.runtime.speech_to_sign.korean_to_gloss import korean_to_gloss

        if not korean.strip():
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="input_validation",
                message="Input text is empty.",
                status_code=422,
            )

        with timer.step("korean_to_gloss"):
            try:
                glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="korean_to_gloss",
                    message=_describe_exception(exc, "Failed to translate Korean text into glosses."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.video",
            "korean_to_gloss",
            timer,
            text_length=len(korean),
            gloss_count=len(glosses),
        )

        if not glosses:
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="korean_to_gloss",
                message="No gloss sequence was generated.",
                status_code=422,
            )

        word_db = self.container.get_word_db()
        jamo_db = load_jamo_db()

        with timer.step("clip_planning"):
            try:
                plan = collect_gloss_segments(glosses, word_db=word_db, jamo_db=jamo_db)
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="clip_planning",
                    message=_describe_exception(exc, "Failed to resolve gloss clips."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.video",
            "clip_planning",
            timer,
            resolved=len(plan["resolved_glosses"]),
            missing=len(plan["missing_glosses"]),
            clip_count=len(plan["clip_paths"]),
        )

        if not plan["clip_paths"]:
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="clip_planning",
                message="No video clips were resolved for the generated glosses.",
                status_code=422,
            )

        output_path = self.container.new_video_path()
        with timer.step("video_compose"):
            try:
                video_path = glosses_to_video(
                    glosses,
                    output=output_path,
                    word_db=word_db,
                    jamo_db=jamo_db,
                )
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="video_compose",
                    message=_describe_exception(exc, "Failed to compose the output sign video."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.video",
            "video_compose",
            timer,
            output_path=str(output_path),
        )

        if video_path is None or not video_path.exists():
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="video_compose",
                message="Failed to compose the output sign video.",
                status_code=500,
            )

        resolved = plan["resolved_glosses"]
        missing = plan["missing_glosses"]
        coverage = round(len(resolved) / len(glosses), 3) if glosses else 0.0

        logger.info(
            f"[speech_to_sign.video] Resolved {len(resolved)}/{len(glosses)} glosses (coverage: {coverage:.1%})"
        )
        if missing:
            logger.warning(f"[speech_to_sign.video] Missing glosses in Word DB: {missing}")
        logger.debug(f"[speech_to_sign.video] Resolved glosses: {resolved}")

        timings = timer.finish()
        logger.info(
            "[speech_to_sign.video] summary | total=%0.3fs | korean_to_gloss=%0.3fs | clip_planning=%0.3fs | video_compose=%0.3fs | glosses=%d | resolved=%d | missing=%d",
            timings.get("total", 0.0),
            timings.get("korean_to_gloss", 0.0),
            timings.get("clip_planning", 0.0),
            timings.get("video_compose", 0.0),
            len(glosses),
            len(resolved),
            len(missing),
        )

        return {
            "korean": korean,
            "glosses": glosses,
            "gloss_str": " ".join(glosses),
            "video_url": self.container.to_public_url(video_path),
            "video_path": str(video_path),
            "resolved_glosses": resolved,
            "missing_glosses": missing,
            "coverage": coverage,
            "timings": timings,
        }

    def _run_keypoint_pipeline(self, korean: str, timer: PipelineTimer) -> dict:
        from app.ai_runtime.runtime.speech_to_sign.gloss_to_keypoints import glosses_to_keypoint_payload
        from app.ai_runtime.runtime.speech_to_sign.korean_to_gloss import korean_to_gloss

        if not korean.strip():
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="input_validation",
                message="Input text is empty.",
                status_code=422,
            )

        with timer.step("korean_to_gloss"):
            try:
                glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="korean_to_gloss",
                    message=_describe_exception(exc, "Failed to translate Korean text into glosses."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.keypoints",
            "korean_to_gloss",
            timer,
            text_length=len(korean),
            gloss_count=len(glosses),
        )

        if not glosses:
            raise PipelineStageError(
                pipeline="speech_to_sign",
                stage="korean_to_gloss",
                message="No gloss sequence was generated.",
                status_code=422,
            )

        with timer.step("keypoint_payload"):
            try:
                keypoint_result = glosses_to_keypoint_payload(glosses)
                keypoint_payload = keypoint_result["payload"]
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="keypoint_payload",
                    message=_describe_exception(exc, "Failed to generate keypoint payload."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.keypoints",
            "keypoint_payload",
            timer,
            resolved=len(keypoint_result["resolved_glosses"]),
            missing=len(keypoint_result["missing_glosses"]),
            frame_count=len(keypoint_payload.get("frames", [])),
        )

        keypoint_path = self.container.new_json_path()
        with timer.step("keypoint_save"):
            try:
                with open(keypoint_path, "w", encoding="utf-8") as handle:
                    json.dump(keypoint_payload, handle, ensure_ascii=False, indent=2)
            except PipelineStageError:
                raise
            except Exception as exc:
                raise PipelineStageError(
                    pipeline="speech_to_sign",
                    stage="keypoint_save",
                    message=_describe_exception(exc, "Failed to save keypoint payload."),
                    status_code=500,
                ) from exc
        _log_pipeline_progress(
            "speech_to_sign.keypoints",
            "keypoint_save",
            timer,
            output_path=str(keypoint_path),
        )

        resolved = keypoint_result["resolved_glosses"]
        missing = keypoint_result["missing_glosses"]
        coverage = keypoint_result["coverage"]

        logger.info(
            f"[speech_to_sign.keypoints] Resolved {len(resolved)}/{len(glosses)} glosses (coverage: {coverage:.1%})"
        )
        if missing:
            logger.warning(f"[speech_to_sign.keypoints] Missing glosses in Word Dic: {missing}")
        logger.debug(f"[speech_to_sign.keypoints] Resolved glosses: {resolved}")

        timings = timer.finish()
        logger.info(
            "[speech_to_sign.keypoints] summary | total=%0.3fs | korean_to_gloss=%0.3fs | keypoint_payload=%0.3fs | keypoint_save=%0.3fs | glosses=%d | resolved=%d | missing=%d | frames=%d",
            timings.get("total", 0.0),
            timings.get("korean_to_gloss", 0.0),
            timings.get("keypoint_payload", 0.0),
            timings.get("keypoint_save", 0.0),
            len(glosses),
            len(resolved),
            len(missing),
            len(keypoint_payload.get("frames", [])),
        )

        return {
            "korean": korean,
            "glosses": glosses,
            "gloss_str": " ".join(glosses),
            "keypoint_url": self.container.to_public_url(keypoint_path),
            "keypoint_path": str(keypoint_path),
            "keypoint_payload": keypoint_payload,
            "resolved_glosses": resolved,
            "missing_glosses": missing,
            "coverage": coverage,
            "timings": timings,
        }


def _describe_exception(exc: Exception, default_message: str) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, str) and detail.strip():
        return detail.strip()

    message = str(exc).strip()
    if message:
        return message

    return default_message


def _log_pipeline_progress(
    pipeline_name: str,
    step_name: str,
    timer: PipelineTimer,
    **metadata: object,
) -> None:
    timings = timer.snapshot()
    step_time = timings.get(step_name)
    elapsed = timings.get("elapsed", 0.0)
    meta = ""
    if metadata:
        meta = " | " + " ".join(f"{key}={value}" for key, value in metadata.items())
    logger.info(
        "[%s] step=%s | took=%0.3fs | elapsed=%0.3fs%s",
        pipeline_name,
        step_name,
        step_time if step_time is not None else 0.0,
        elapsed,
        meta,
    )
