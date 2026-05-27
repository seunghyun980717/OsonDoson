def _mock_keypoint_frame(frame_index: int) -> dict:
    return {
        "frame_index": frame_index,
        "pose": [
            {"x": round(i * 0.03 + frame_index * 0.01, 3), "y": round(i * 0.02, 3), "z": 0.0}
            for i in range(33)
        ],
        "left_hand": [
            {"x": round(i * 0.05, 3), "y": round(i * 0.04 + frame_index * 0.01, 3), "z": 0.0}
            for i in range(21)
        ],
        "right_hand": [
            {"x": round(i * 0.05, 3), "y": round(i * 0.04, 3), "z": 0.0}
            for i in range(21)
        ],
    }


async def mock_speech_to_sign(korean: str) -> dict:
    text = korean.strip() or "어디로 가고 싶으세요?"
    return {
        "korean": text,
        "glosses": ["장소", "가다", "원하다"],
        "gloss_str": "장소 가다 원하다",
        "keypoint_sequence": [_mock_keypoint_frame(i) for i in range(3)],
    }


async def mock_audio_to_text(audio_base64: str, audio_format: str) -> str:
    _ = audio_base64, audio_format
    return "안녕하세요."


async def mock_keypoints_to_speech(frames: list) -> dict:
    _ = frames
    return {
        "glosses": ["감사"],
        "korean": "감사합니다.",
        "audio_bytes": b"mock mp3 bytes for signer_keypoints",
    }
