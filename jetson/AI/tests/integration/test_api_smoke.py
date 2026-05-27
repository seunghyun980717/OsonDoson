from fastapi.testclient import TestClient

from app.main import create_app
from app.services.sign_to_speech import SignToSpeechService
from app.services.speech_to_sign import SpeechToSignService


def test_health_endpoint(monkeypatch):
    monkeypatch.setenv("LKS_PRELOAD_MODELS", "0")
    with TestClient(create_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_speech_to_sign_text_contract(monkeypatch):
    def fake_text_to_sign(self, text):
        return {
            "korean": text,
            "glosses": ["HELLO"],
            "gloss_str": "HELLO",
            "video_url": "/static/video/mock.mp4",
            "video_path": "mock.mp4",
            "resolved_glosses": ["HELLO"],
            "missing_glosses": [],
            "coverage": 1.0,
            "timings": {"total": 0.01},
        }

    monkeypatch.setattr(SpeechToSignService, "text_to_sign", fake_text_to_sign)
    with TestClient(create_app()) as client:
        response = client.post("/speech-to-sign/text", json={"text": "안녕하세요"})
    assert response.status_code == 200
    assert response.json()["video_url"].endswith("mock.mp4")


def test_sign_to_speech_sample_contract(monkeypatch):
    def fake_sample_to_speech(self, name):
        return {
            "gloss": "HELLO",
            "korean": "안녕하세요",
            "audio_url": "/static/audio/mock.mp3",
            "audio_path": "mock.mp3",
            "timings": {"total": 0.02},
            "label": name,
            "label_match": False,
        }

    monkeypatch.setattr(SignToSpeechService, "sample_to_speech", fake_sample_to_speech)
    with TestClient(create_app()) as client:
        response = client.post("/sign-to-speech/sample?name=sample")
    assert response.status_code == 200
    assert response.json()["audio_url"].endswith("mock.mp3")
