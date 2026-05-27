from pathlib import Path

from runtime.speech_to_sign.gloss_to_video import load_word_db


def test_word_db_resolves_existing_clips():
    word_db = load_word_db()
    assert word_db
    sample_path = Path(next(iter(word_db.values())))
    assert sample_path.exists()
    assert sample_path.suffix == ".mp4"

