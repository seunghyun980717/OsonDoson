from app.settings import PROFILES, load_settings


def test_load_settings_uses_known_profile(monkeypatch):
    monkeypatch.setenv("LKS_PROFILE", "runpod")
    settings = load_settings()
    assert settings.profile == PROFILES["runpod"]
    assert settings.static_dir.exists()
    assert settings.audio_dir.exists()
    assert settings.video_dir.exists()


def test_load_settings_supports_generated_word_db(monkeypatch):
    monkeypatch.setenv("LKS_WORD_DB_MODE", "generated")
    settings = load_settings()
    assert settings.word_db_path.name == "word_db_generated.json"
