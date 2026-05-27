from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from app.container import RuntimeContainer
from app.services.exceptions import (
    GlossSequenceEmptyError,
    TextInputEmptyError,
    VideoClipResolutionError,
    VideoComposeFailedError,
)
from app.services.timing import PipelineTimer

logger = logging.getLogger(__name__)


class SpeechToSignService:
    def __init__(self, container: RuntimeContainer):
        self.container = container

    def text_to_sign(self, text: str) -> dict:
        timer = PipelineTimer("speech_to_sign.text")
        return self._run_pipeline(text, timer)

    def text_to_keypoints(self, text: str) -> dict:
        logger.info("text_to_keypoints 처리를 시작합니다.")
        timer = PipelineTimer("speech_to_sign.text.keypoints")
        result = self._run_keypoint_pipeline(text, timer)
        logger.info("text_to_keypoints 처리가 완료되었습니다. gloss 수=%s", len(result.get("glosses", [])))
        return result

    def audio_to_keypoints(self, audio_path: Path) -> dict:
        logger.info("audio_to_keypoints 처리를 시작합니다. audio_path=%s", audio_path)
        timer = PipelineTimer("speech_to_sign.audio.keypoints")
        with timer.step("stt"):
            from runtime.speech_to_sign.stt import transcribe_file

            stt_started_at = time.perf_counter()

            try:
                korean = transcribe_file(audio_path, model=self.container.get_stt_model())
            except Exception:
                logger.exception("audio_to_keypoints의 STT 단계에서 오류가 발생했습니다. audio_path=%s", audio_path)
                raise
            stt_elapsed = time.perf_counter() - stt_started_at

        result = self._run_keypoint_pipeline(korean, timer)
        result["timings"] = {
            "stt": round(stt_elapsed, 6),
            **result.get("timings", {}),
        }
        result["source_audio"] = str(audio_path)
        logger.info("audio_to_keypoints 처리가 완료되었습니다. gloss 수=%s", len(result.get("glosses", [])))
        return result

    def audio_to_sign(self, audio_path: Path) -> dict:
        timer = PipelineTimer("speech_to_sign.audio")
        with timer.step("stt"):
            from runtime.speech_to_sign.stt import transcribe_file

            korean = transcribe_file(audio_path, model=self.container.get_stt_model())
        result = self._run_pipeline(korean, timer)
        result["source_audio"] = str(audio_path)
        return result

    def _run_pipeline(self, korean: str, timer: PipelineTimer) -> dict:
        from runtime.speech_to_sign.gloss_to_video import collect_gloss_segments, glosses_to_video, load_jamo_db
        from runtime.speech_to_sign.korean_to_gloss import korean_to_gloss

        if not korean.strip():
            logger.warning("video 파이프라인에서 빈 입력 텍스트가 감지되었습니다.")
            raise TextInputEmptyError(stage="video_pipeline")

        with timer.step("korean_to_gloss"):
            glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())

        if not glosses:
            logger.warning("video 파이프라인의 korean_to_gloss 단계에서 빈 gloss 시퀀스가 반환되었습니다. korean=%s", korean)
            raise GlossSequenceEmptyError(stage="korean_to_gloss")

        word_db = self.container.get_word_db()
        jamo_db = load_jamo_db()

        with timer.step("clip_planning"):
            plan = collect_gloss_segments(glosses, word_db=word_db, jamo_db=jamo_db)

        if not plan["clip_paths"]:
            logger.warning("clip_planning 단계에서 대응되는 비디오 클립을 찾지 못했습니다. glosses=%s", glosses)
            raise VideoClipResolutionError()

        output_path = self.container.new_video_path()
        with timer.step("video_compose"):
            video_path = glosses_to_video(
                glosses,
                output=output_path,
                word_db=word_db,
                jamo_db=jamo_db,
            )

        if video_path is None or not video_path.exists():
            logger.warning("video_compose 단계에서 출력 수어 영상이 생성되지 않았습니다. glosses=%s", glosses)
            raise VideoComposeFailedError()

        resolved = plan["resolved_glosses"]
        missing = plan["missing_glosses"]
        coverage = round(len(resolved) / len(glosses), 3) if glosses else 0.0

        return {
            "korean": korean,
            "glosses": glosses,
            "gloss_str": " ".join(glosses),
            "video_url": self.container.to_public_url(video_path),
            "video_path": str(video_path),
            "resolved_glosses": resolved,
            "missing_glosses": missing,
            "coverage": coverage,
            "timings": timer.finish(),
        }

    def _run_keypoint_pipeline(self, korean: str, timer: PipelineTimer) -> dict:
        from runtime.speech_to_sign.gloss_to_keypoints import glosses_to_keypoint_payload
        from runtime.speech_to_sign.korean_to_gloss import korean_to_gloss

        if not korean.strip():
            logger.warning("keypoint 파이프라인에서 빈 입력 텍스트가 감지되었습니다.")
            raise TextInputEmptyError("입력 텍스트가 비어 있습니다.")

        with timer.step("korean_to_gloss"):
            glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())

        if not glosses:
            logger.warning("korean_to_gloss 단계에서 빈 gloss 시퀀스가 반환되었습니다. korean=%s", korean)
            raise GlossSequenceEmptyError("생성된 gloss 시퀀스가 없습니다.")

        with timer.step("keypoint_payload"):
            try:
                keypoint_result = glosses_to_keypoint_payload(glosses)
                keypoint_payload = keypoint_result["payload"]
            except Exception:
                logger.exception("keypoint payload 생성 중 오류가 발생했습니다. glosses=%s", glosses)
                raise

        keypoint_path = self.container.new_json_path()
        with timer.step("keypoint_save"):
            try:
                with open(keypoint_path, "w", encoding="utf-8") as handle:
                    json.dump(keypoint_payload, handle, ensure_ascii=False, indent=2)
            except Exception:
                logger.exception("keypoint payload 저장 중 오류가 발생했습니다. path=%s", keypoint_path)
                raise

        resolved = keypoint_result["resolved_glosses"]
        missing = keypoint_result["missing_glosses"]
        coverage = keypoint_result["coverage"]

        logger.info(
            f"[speech_to_sign.keypoints] Resolved {len(resolved)}/{len(glosses)} glosses (coverage: {coverage:.1%})"
        )
        if missing:
            logger.warning(f"[speech_to_sign.keypoints] Missing glosses in Word Dic: {missing}")
        logger.debug(f"[speech_to_sign.keypoints] Resolved glosses: {resolved}")

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
            "timings": timer.finish(),
        }
