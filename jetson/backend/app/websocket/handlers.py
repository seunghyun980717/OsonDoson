import logging

from fastapi import FastAPI

from app.ai_runtime.services.exceptions import PipelineStageError
from app.ai_runtime.state import get_ai_runtime_state
from app.services.translation_service import (
    run_sign_to_speech,
    run_speech_to_sign_audio,
    run_speech_to_sign_text,
)
from app.websocket.manager import manager

logger = logging.getLogger(__name__)

FRAME_REQUIRED_KEYS = (
    "poseLandmarks",
    "leftHandLandmarks",
    "rightHandLandmarks",
    "videoWidth",
    "videoHeight",
)

LANDMARK_REQUIRED_KEYS = ("x", "y", "z", "visibility")
SIGN_TO_SPEECH_RESULT_KEYS = ("glosses", "korean", "audio_url")
SPEECH_TO_SIGN_RESULT_KEYS = (
    "korean",
    "glosses",
    "gloss_str",
    "keypoint_url",
    "keypoint_path",
    "keypoint_payload",
    "resolved_glosses",
    "missing_glosses",
    "coverage",
    "timings",
)
INVALID_SIGN_TO_SPEECH_RESULT_MESSAGE = "invalid sign_to_speech result payload"
INVALID_SPEECH_TO_SIGN_RESULT_MESSAGE = "invalid speech_to_sign result payload"
SUPPORTED_HEARING_AUDIO_FORMATS = {"webm", "wav"}


async def handle_hearing_message(app: FastAPI, data: dict) -> None:
    msg_type = data.get("type")

    logger.info(
        "Incoming hearing message: type=%s keys=%s",
        msg_type,
        list(data.keys()),
    )

    if msg_type == "ping":
        websocket = manager.hearing
        if websocket is not None:
            await websocket.send_json({"type": "pong"})
        return

    if msg_type == "hearing_text":
        await handle_hearing_text(app, data)
        return

    if msg_type == "hearing_audio":
        await handle_hearing_audio(app, data)
        return

    await manager.send_error("hearing", f"unknown message type: {msg_type}")


async def handle_signer_message(app: FastAPI, data: dict) -> None:
    msg_type = data.get("type")

    logger.info(
        "Incoming signer message: type=%s keys=%s",
        msg_type,
        list(data.keys()),
    )

    if msg_type == "ping":
        websocket = manager.signer
        if websocket is not None:
            await websocket.send_json({"type": "pong"})
        return

    if msg_type == "signer_keypoints":
        await handle_signer_keypoints(app, data)
        return

    await manager.send_error("signer", f"unknown message type: {msg_type}")


async def handle_hearing_text(app: FastAPI, data: dict) -> None:
    runtime_state = get_ai_runtime_state(app)
    korean = data.get("text", "")

    logger.info(
        "Incoming hearing_text payload: textLength=%s",
        len(korean) if isinstance(korean, str) else None,
    )

    error = validate_hearing_text_payload(korean)
    if error is not None:
        logger.warning("Rejected hearing_text payload: %s", error)
        await manager.send_error("hearing", error)
        return

    korean = korean.strip()
    logger.info("Accepted hearing_text payload: textLength=%d", len(korean))
    await manager.send_processing("hearing", "speech_to_sign")

    try:
        _ = runtime_state.speech_to_sign
        logger.info("Starting speech_to_sign text pipeline: textLength=%d", len(korean))
        result = await run_speech_to_sign_text(app, korean)
        logger.info(
            "Completed speech_to_sign text pipeline: total=%0.3fs glossCount=%d hasKeypointPayload=%s",
            result.get("timings", {}).get("total", 0.0) if isinstance(result.get("timings"), dict) else 0.0,
            len(result.get("glosses", [])) if isinstance(result.get("glosses"), list) else 0,
            bool(result.get("keypoint_payload")),
        )
    except PipelineStageError as exc:
        logger.exception(
            "speech_to_sign pipeline failed: stage=%s statusCode=%s message=%s",
            exc.stage,
            exc.status_code,
            exc.message,
        )
        await manager.send_error("hearing", exc.to_payload())
        return
    except Exception:
        logger.exception("speech_to_sign pipeline failed")
        await manager.send_error("hearing", "speech_to_sign pipeline failed")
        return

    try:
        logger.info("Sending speech_to_sign text result to signer peer")
        delivered = await send_speech_to_sign_result(result)
    except ValueError as exc:
        logger.warning("Rejected speech_to_sign result payload: %s", exc)
        await manager.send_error("hearing", INVALID_SPEECH_TO_SIGN_RESULT_MESSAGE)
        return

    if not delivered:
        logger.info("speech_to_sign result not delivered because signer peer is unavailable")


async def handle_hearing_audio(app: FastAPI, data: dict) -> None:
    runtime_state = get_ai_runtime_state(app)
    audio_base64 = data.get("audio_base64", "")
    audio_format = data.get("format")

    logger.info(
        "Incoming hearing_audio payload: format=%s audioBase64Length=%s",
        audio_format,
        len(audio_base64) if isinstance(audio_base64, str) else None,
    )

    error = validate_hearing_audio_payload(audio_base64, audio_format)
    if error is not None:
        logger.warning("Rejected hearing_audio payload: %s", error)
        await manager.send_error("hearing", error)
        return

    audio_format = audio_format.strip().lower()
    logger.info(
        "Accepted hearing_audio payload: format=%s audioBase64Length=%d",
        audio_format,
        len(audio_base64),
    )
    await manager.send_processing("hearing", "speech_to_sign")

    try:
        _ = runtime_state.speech_to_sign
        logger.info("Starting speech_to_sign audio pipeline: format=%s", audio_format)
        result = await run_speech_to_sign_audio(app, audio_base64, audio_format)
        logger.info(
            "Completed speech_to_sign audio pipeline: total=%0.3fs glossCount=%d hasKeypointPayload=%s",
            result.get("timings", {}).get("total", 0.0) if isinstance(result.get("timings"), dict) else 0.0,
            len(result.get("glosses", [])) if isinstance(result.get("glosses"), list) else 0,
            bool(result.get("keypoint_payload")),
        )
    except PipelineStageError as exc:
        logger.exception(
            "speech_to_sign pipeline failed: stage=%s statusCode=%s message=%s",
            exc.stage,
            exc.status_code,
            exc.message,
        )
        await manager.send_error("hearing", exc.to_payload())
        return
    except Exception:
        logger.exception("speech_to_sign pipeline failed")
        await manager.send_error("hearing", "speech_to_sign pipeline failed")
        return

    try:
        logger.info("Sending speech_to_sign audio result to signer peer")
        delivered = await send_speech_to_sign_result(result)
    except ValueError as exc:
        logger.warning("Rejected speech_to_sign result payload: %s", exc)
        await manager.send_error("hearing", INVALID_SPEECH_TO_SIGN_RESULT_MESSAGE)
        return

    if not delivered:
        logger.info("speech_to_sign result not delivered because signer peer is unavailable")


async def handle_signer_keypoints(app: FastAPI, data: dict) -> None:
    runtime_state = get_ai_runtime_state(app)
    frames = data.get("frames", [])

    logger.info(
        "Incoming signer_keypoints payload: frameCount=%s",
        len(frames) if isinstance(frames, list) else None,
    )

    error = validate_signer_frames(frames)
    if error is not None:
        logger.warning("Rejected signer_keypoints payload: %s", error)
        await manager.send_error("signer", error)
        return

    logger.info("Accepted signer_keypoints payload: frameCount=%d", len(frames))
    await manager.send_processing("signer", "sign_to_speech")

    try:
        _ = runtime_state.sign_to_speech
        logger.info("Starting sign_to_speech pipeline: frameCount=%d", len(frames))
        result = await run_sign_to_speech(app, frames)
        logger.info(
            "Completed sign_to_speech pipeline: frameCount=%d glosses=%s hasAudio=%s",
            len(frames),
            result.get("glosses"),
            bool(result.get("audio_url")),
        )
    except PipelineStageError as exc:
        logger.exception(
            "sign_to_speech pipeline failed: stage=%s statusCode=%s message=%s",
            exc.stage,
            exc.status_code,
            exc.message,
        )
        await manager.send_error("signer", exc.to_payload())
        return
    except Exception:
        logger.exception("sign_to_speech pipeline failed")
        await manager.send_error("signer", "sign_to_speech pipeline failed")
        return

    try:
        logger.info("Sending sign_to_speech result to hearing peer")
        delivered = await send_sign_to_speech_result(result)
    except ValueError as exc:
        logger.warning("Rejected sign_to_speech result payload: %s", exc)
        await manager.send_error("signer", INVALID_SIGN_TO_SPEECH_RESULT_MESSAGE)
        return

    if not delivered:
        logger.info("sign_to_speech result not delivered because hearing peer is unavailable")


async def send_speech_to_sign_result(result: dict) -> bool:
    payload = normalize_speech_to_sign_result(result)
    return await manager.send_to_peer(
        "hearing",
        {
            "type": "speech_to_sign_result",
            "source": "hearing",
            **payload,
        },
    )


async def send_sign_to_speech_result(result: dict) -> bool:
    payload = normalize_sign_to_speech_result(result)
    return await manager.send_to_peer(
        "signer",
        {
            "type": "sign_to_speech_result",
            "source": "signer",
            "glosses": payload["glosses"],
            "korean": payload["korean"],
            "audio_url": payload["audio_url"],
            "audio": {
                "format": "mp3",
                "content_type": "audio/mpeg",
                "url": payload["audio_url"],
            },
        },
    )


def normalize_speech_to_sign_result(result: object) -> dict:
    if not isinstance(result, dict):
        raise ValueError("speech_to_sign result must be an object")

    for key in SPEECH_TO_SIGN_RESULT_KEYS:
        if key not in result:
            raise ValueError(f"speech_to_sign result is missing '{key}'")

    korean = result["korean"]
    if not isinstance(korean, str) or not korean.strip():
        raise ValueError("'korean' must be a non-empty string")

    glosses = result["glosses"]
    if not isinstance(glosses, list) or not glosses:
        raise ValueError("'glosses' must be a non-empty list")
    if not all(isinstance(gloss, str) and gloss.strip() for gloss in glosses):
        raise ValueError("'glosses' must contain non-empty strings")

    gloss_str = result["gloss_str"]
    if not isinstance(gloss_str, str) or not gloss_str.strip():
        raise ValueError("'gloss_str' must be a non-empty string")

    keypoint_url = result["keypoint_url"]
    if keypoint_url is not None and (not isinstance(keypoint_url, str) or not keypoint_url.strip()):
        raise ValueError("'keypoint_url' must be a non-empty string when provided")

    keypoint_path = result["keypoint_path"]
    if keypoint_path is not None and (not isinstance(keypoint_path, str) or not keypoint_path.strip()):
        raise ValueError("'keypoint_path' must be a non-empty string when provided")

    keypoint_payload = result["keypoint_payload"]
    if not isinstance(keypoint_payload, dict):
        raise ValueError("'keypoint_payload' must be an object")

    resolved_glosses = result["resolved_glosses"]
    if not isinstance(resolved_glosses, list):
        raise ValueError("'resolved_glosses' must be a list")
    if not all(isinstance(gloss, str) for gloss in resolved_glosses):
        raise ValueError("'resolved_glosses' must contain strings")

    missing_glosses = result["missing_glosses"]
    if not isinstance(missing_glosses, list):
        raise ValueError("'missing_glosses' must be a list")
    if not all(isinstance(gloss, str) for gloss in missing_glosses):
        raise ValueError("'missing_glosses' must contain strings")

    coverage = result["coverage"]
    if not isinstance(coverage, (int, float)):
        raise ValueError("'coverage' must be numeric")

    timings = result["timings"]
    if not isinstance(timings, dict):
        raise ValueError("'timings' must be an object")

    return {
        "korean": korean.strip(),
        "glosses": [gloss.strip() for gloss in glosses],
        "gloss_str": gloss_str.strip(),
        "keypoint_url": keypoint_url.strip() if isinstance(keypoint_url, str) else None,
        "keypoint_path": keypoint_path.strip() if isinstance(keypoint_path, str) else None,
        "keypoint_payload": keypoint_payload,
        "resolved_glosses": [gloss.strip() for gloss in resolved_glosses],
        "missing_glosses": [gloss.strip() for gloss in missing_glosses],
        "coverage": float(coverage),
        "timings": {str(key): float(value) for key, value in timings.items()},
    }


def normalize_sign_to_speech_result(result: object) -> dict:
    if not isinstance(result, dict):
        raise ValueError("sign_to_speech result must be an object")

    for key in SIGN_TO_SPEECH_RESULT_KEYS:
        if key not in result:
            raise ValueError(f"sign_to_speech result is missing '{key}'")

    glosses = result["glosses"]
    if not isinstance(glosses, list) or not glosses:
        raise ValueError("'glosses' must be a non-empty list")
    if not all(isinstance(gloss, str) and gloss.strip() for gloss in glosses):
        raise ValueError("'glosses' must contain non-empty strings")

    korean = result["korean"]
    if not isinstance(korean, str) or not korean.strip():
        raise ValueError("'korean' must be a non-empty string")

    audio_url = result["audio_url"]
    if audio_url is not None and (not isinstance(audio_url, str) or not audio_url.strip()):
        raise ValueError("'audio_url' must be a non-empty string when provided")

    return {
        "glosses": [gloss.strip() for gloss in glosses],
        "korean": korean.strip(),
        "audio_url": audio_url.strip() if isinstance(audio_url, str) else None,
    }


def validate_signer_frames(frames: object) -> str | None:
    if not isinstance(frames, list):
        return "'frames' must be a list"
    if not frames:
        return "'frames' must include at least one frame"

    for index, frame in enumerate(frames):
        error = validate_signer_frame(frame, index)
        if error is not None:
            return error
    return None


def validate_hearing_text_payload(text: object) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return "'text' must be a non-empty string"
    return None


def validate_hearing_audio_payload(audio_base64: object, audio_format: object) -> str | None:
    if not isinstance(audio_base64, str) or not audio_base64.strip():
        return "'audio_base64' must be a non-empty string"

    if not isinstance(audio_format, str) or not audio_format.strip():
        return "'format' must be provided"

    normalized_format = audio_format.strip().lower()
    if normalized_format not in SUPPORTED_HEARING_AUDIO_FORMATS:
        allowed_formats = ", ".join(sorted(SUPPORTED_HEARING_AUDIO_FORMATS))
        return f"'format' must be one of: {allowed_formats}"

    return None


def validate_keypoint_sequence_frame(frame: object, index: int) -> str | None:
    if not isinstance(frame, dict):
        return f"keypoint_sequence[{index}] must be an object"

    required_keys = ("frame_index", "pose", "left_hand", "right_hand")
    for key in required_keys:
        if key not in frame:
            return f"keypoint_sequence[{index}] is missing '{key}'"

    if not isinstance(frame["frame_index"], int) or frame["frame_index"] < 0:
        return f"keypoint_sequence[{index}].frame_index must be a non-negative integer"

    for key in ("pose", "left_hand", "right_hand"):
        if not isinstance(frame[key], list):
            return f"keypoint_sequence[{index}].{key} must be a list"
        error = validate_xyz_points(frame[key], index, key)
        if error is not None:
            return error

    return None


def validate_xyz_points(points: list[object], frame_index: int, field_name: str) -> str | None:
    for point_index, point in enumerate(points):
        if not isinstance(point, dict):
            return f"keypoint_sequence[{frame_index}].{field_name}[{point_index}] must be an object"

        for key in ("x", "y", "z"):
            if key not in point:
                return f"keypoint_sequence[{frame_index}].{field_name}[{point_index}] is missing '{key}'"
            if not isinstance(point[key], (int, float)):
                return f"keypoint_sequence[{frame_index}].{field_name}[{point_index}].{key} must be numeric"

    return None


def validate_signer_frame(frame: object, index: int) -> str | None:
    if not isinstance(frame, dict):
        return f"frame[{index}] must be an object"

    for key in FRAME_REQUIRED_KEYS:
        if key not in frame:
            return f"frame[{index}] is missing '{key}'"

    for key in ("poseLandmarks", "leftHandLandmarks", "rightHandLandmarks"):
        if not isinstance(frame[key], list):
            return f"frame[{index}].{key} must be a list"

    if not isinstance(frame["videoWidth"], int) or frame["videoWidth"] <= 0:
        return f"frame[{index}].videoWidth must be a positive integer"
    if not isinstance(frame["videoHeight"], int) or frame["videoHeight"] <= 0:
        return f"frame[{index}].videoHeight must be a positive integer"

    for key in ("poseLandmarks", "leftHandLandmarks", "rightHandLandmarks"):
        error = validate_landmarks(frame[key], index, key)
        if error is not None:
            return error
    return None


def validate_landmarks(landmarks: list[object], frame_index: int, field_name: str) -> str | None:
    for landmark_index, landmark in enumerate(landmarks):
        if not isinstance(landmark, dict):
            return f"frame[{frame_index}].{field_name}[{landmark_index}] must be an object"

        for key in LANDMARK_REQUIRED_KEYS:
            if key not in landmark:
                return f"frame[{frame_index}].{field_name}[{landmark_index}] is missing '{key}'"
            if not isinstance(landmark[key], (int, float)):
                return f"frame[{frame_index}].{field_name}[{landmark_index}].{key} must be numeric"
    return None
