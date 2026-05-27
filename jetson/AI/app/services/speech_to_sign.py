from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException

from app.container import RuntimeContainer
from app.services.timing import PipelineTimer


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
            from runtime.speech_to_sign.stt import transcribe_file

            korean = transcribe_file(audio_path, model=self.container.get_stt_model())
        result = self._run_pipeline(korean, timer)
        result["source_audio"] = str(audio_path)
        return result

    def _run_pipeline(self, korean: str, timer: PipelineTimer) -> dict:
        from runtime.speech_to_sign.gloss_to_video import collect_gloss_segments, glosses_to_video, load_jamo_db
        from runtime.speech_to_sign.korean_to_gloss import korean_to_gloss

        if not korean.strip():
            raise HTTPException(status_code=422, detail="Input text is empty.")

        with timer.step("korean_to_gloss"):
            glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())

        if not glosses:
            raise HTTPException(status_code=422, detail="No gloss sequence was generated.")

        word_db = self.container.get_word_db()
        jamo_db = load_jamo_db()

        with timer.step("clip_planning"):
            plan = collect_gloss_segments(glosses, word_db=word_db, jamo_db=jamo_db)

        if not plan["clip_paths"]:
            raise HTTPException(status_code=422, detail="No video clips were resolved for the generated glosses.")

        output_path = self.container.new_video_path()
        with timer.step("video_compose"):
            video_path = glosses_to_video(
                glosses,
                output=output_path,
                word_db=word_db,
                jamo_db=jamo_db,
            )

        if video_path is None or not video_path.exists():
            raise HTTPException(status_code=500, detail="Failed to compose the output sign video.")

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
            raise HTTPException(status_code=422, detail="Input text is empty.")

        with timer.step("korean_to_gloss"):
            glosses = korean_to_gloss(korean, retriever=self.container.get_retriever())

        if not glosses:
            raise HTTPException(status_code=422, detail="No gloss sequence was generated.")

        with timer.step("keypoint_payload"):
            keypoint_result = glosses_to_keypoint_payload(glosses)
            keypoint_payload = keypoint_result["payload"]

        keypoint_path = self.container.new_json_path()
        with timer.step("keypoint_save"):
            with open(keypoint_path, "w", encoding="utf-8") as handle:
                json.dump(keypoint_payload, handle, ensure_ascii=False, indent=2)

        resolved = keypoint_result["resolved_glosses"]
        missing = keypoint_result["missing_glosses"]
        coverage = keypoint_result["coverage"]

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

