from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import torch
from fastapi import HTTPException

from app.container import RuntimeContainer
from app.services.timing import PipelineTimer
from core.config import CACHE_DIR


class SignToSpeechService:
    def __init__(self, container: RuntimeContainer):
        self.container = container

    def sample_to_speech(self, name: str) -> dict[str, Any]:
        npy_path = CACHE_DIR / f"{name}.npy"
        if not npy_path.exists():
            available = [path.stem for path in sorted(CACHE_DIR.glob("*.npy"))[:5]]
            raise HTTPException(status_code=404, detail=f"Sample '{name}' was not found. Examples: {available}")
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
            raise HTTPException(status_code=422, detail=f"Failed to parse npy payload: {exc}") from exc
        return self._keypoints_to_speech(keypoints, pipeline_name="sign_to_speech.npy")

    def gloss_to_speech(self, gloss: str) -> dict[str, Any]:
        if not gloss.strip():
            raise HTTPException(status_code=422, detail="Gloss input is empty.")
        timer = PipelineTimer("sign_to_speech.gloss")
        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)
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

    def video_to_speech(self, video_path: Path, *, visualize: bool = False) -> dict[str, Any]:
        timer = PipelineTimer("sign_to_speech.video")
        with timer.step("video_to_keypoints"):
            from core.data_utils.video_to_keypoints import video_to_keypoints

            keypoints = video_to_keypoints(video_path)
        result = self._keypoints_to_speech(keypoints, timer=timer)
        if visualize and keypoints is not None:
            with timer.step("visualize"):
                result["visualize_url"] = self._visualize_keypoints(
                    keypoints, gloss=result.get("gloss", ""), overlay_video=video_path
                )
            result["timings"] = timer.finish()
        return result

    def frames_to_speech(self, frames: list[dict]) -> dict[str, Any]:
        if not frames:
            raise HTTPException(status_code=400, detail="No frames were provided.")
        timer = PipelineTimer("sign_to_speech.frames")
        with timer.step("frame_normalize"):
            from core.data_utils.mediapipe_converter import frames_to_sequence_v2

            keypoints = frames_to_sequence_v2(frames)
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
            raise HTTPException(status_code=422, detail="No keypoints were extracted.")
        if keypoints.ndim != 2 or keypoints.shape[1] != 150:
            raise HTTPException(status_code=422, detail=f"Unexpected keypoint shape: {keypoints.shape}")

        timer = timer or PipelineTimer(pipeline_name or "sign_to_speech.keypoints")

        with timer.step("ctc_inference"):
            gloss = self._ctc_infer(keypoints)
        if not gloss:
            raise HTTPException(status_code=422, detail="CTC inference returned an empty gloss sequence.")

        with timer.step("gloss_to_korean"):
            korean = self._translate_gloss(gloss)

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
        self.container.get_translator()
        from runtime.sign_to_speech.gloss_to_korean import gloss_to_korean

        korean = gloss_to_korean(gloss)
        if not korean:
            raise HTTPException(status_code=422, detail="Failed to translate gloss into Korean.")
        return korean

    def _visualize_keypoints(
        self,
        keypoints: np.ndarray,
        gloss: str = "",
        overlay_video: Path | None = None,
    ) -> str | None:
        import cv2
        from visualize_npy import (
            COLOR_LEFT_HAND, COLOR_POSE, COLOR_RIGHT_HAND,
            HAND_CONNECTIONS, POSE_CONNECTIONS,
            denormalize, draw_gloss, draw_legend, draw_skeleton,
        )

        out_path = self.container.new_video_path(suffix=".mp4")
        T = len(keypoints)
        pts_all = keypoints.reshape(T, 67, 2)

        cap = None
        fps = 30.0
        W, H = 640, 480
        if overlay_video and overlay_video.exists():
            cap = cv2.VideoCapture(str(overlay_video))
            if cap.isOpened():
                fps = cap.get(cv2.CAP_PROP_FPS) or fps
                W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        px = denormalize(pts_all, W, H)

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(out_path), fourcc, fps, (W, H))

        for t in range(T):
            if cap and cap.isOpened():
                ret, frame = cap.read()
                frame = frame if ret else np.zeros((H, W, 3), dtype=np.uint8)
            else:
                frame = np.zeros((H, W, 3), dtype=np.uint8)

            overlay = frame.copy()
            draw_skeleton(overlay, px[t, :25],   POSE_CONNECTIONS,  COLOR_POSE,       r=4, t=2)
            draw_skeleton(overlay, px[t, 25:46], HAND_CONNECTIONS, COLOR_LEFT_HAND,  r=2, t=1)
            draw_skeleton(overlay, px[t, 46:67], HAND_CONNECTIONS, COLOR_RIGHT_HAND, r=2, t=1)
            frame = cv2.addWeighted(overlay, 0.9, frame, 0.1, 0)
            draw_legend(frame)
            if gloss:
                draw_gloss(frame, gloss)
            writer.write(frame)

        if cap:
            cap.release()
        writer.release()
        return self.container.to_public_url(out_path)

    def _synthesize_audio(self, korean: str) -> str | None:
        if not self.container.settings.enable_tts:
            return None
        from runtime.sign_to_speech.tts import speak

        audio_path = self.container.new_audio_path()
        try:
            result = speak(korean, output_path=audio_path, play=False)
        except Exception as exc:
            print(f"[tts] synthesis failed: {exc}")
            return None
        if result is None or not audio_path.exists():
            return None
        return self.container.to_public_url(audio_path)

