from __future__ import annotations

import csv
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.ai_runtime.settings import AppSettings
from app.ai_runtime.core.config import TRAIN_CSV, VAL_CSV


@dataclass
class RuntimeContainer:
    settings: AppSettings
    device_info: dict[str, Any] | None = None
    retriever: object | None = None
    translator: object | None = None
    word_db: dict[str, str] = field(default_factory=dict)
    stt_model: object | None = None
    ctc_model: object | None = None
    ctc_vocab: object | None = None
    label_index: dict[str, str] = field(default_factory=dict)

    def startup(self) -> None:
        from app.ai_runtime.runtime.sign_to_speech.infer import get_runtime_device_info
        from app.ai_runtime.runtime.speech_to_sign.gloss_to_video import load_word_db

        started = time.perf_counter()
        self.device_info = get_runtime_device_info()
        self.word_db = load_word_db()
        self.label_index = self._load_label_index()

        if self.settings.preload_models:
            self.get_translator()
            self.get_ctc_model()
            self.get_stt_model()
            self.get_retriever()

        elapsed = time.perf_counter() - started
        print(
            "[startup] profile={profile} backend={backend} clips={clips} word_db={word_db} preload={preload} elapsed={elapsed:.2f}s".format(
                profile=self.settings.profile.name,
                backend=self.settings.translation_backend,
                clips=len(self.word_db),
                word_db=self.settings.word_db_path.name,
                preload=self.settings.preload_models,
                elapsed=elapsed,
            )
        )

    def get_word_db(self) -> dict[str, str]:
        if not self.word_db:
            from app.ai_runtime.runtime.speech_to_sign.gloss_to_video import load_word_db

            self.word_db = load_word_db()
        return self.word_db

    def get_retriever(self) -> object | None:
        if self.settings.translation_backend not in {"ollama", "openai"}:
            return None
        if self.retriever is None:
            from app.ai_runtime.core.data_utils.gloss_retriever import GlossRetriever

            self.retriever = GlossRetriever()
        return self.retriever

    def get_translator(self) -> object | None:
        if self.settings.translation_backend != "t5":
            return None
        if self.translator is None:
            from app.ai_runtime.core.seq2seq.infer import _get_translator

            self.translator = _get_translator()
        return self.translator

    def get_ctc_model(self) -> tuple[object, object]:
        if self.ctc_model is None or self.ctc_vocab is None:
            from app.ai_runtime.runtime.sign_to_speech.infer import load_model

            self.ctc_model, self.ctc_vocab = load_model()
        return self.ctc_model, self.ctc_vocab

    def get_stt_model(self) -> object:
        if not self.settings.enable_stt:
            raise RuntimeError("STT is disabled for this profile.")
        if self.stt_model is None:
            from app.ai_runtime.runtime.speech_to_sign.stt import load_model

            self.stt_model = load_model("base")
        return self.stt_model

    def new_audio_path(self, suffix: str = ".mp3") -> Path:
        return self.settings.audio_dir / f"{uuid4().hex}{suffix}"

    def new_video_path(self, suffix: str = ".mp4") -> Path:
        return self.settings.video_dir / f"{uuid4().hex}{suffix}"

    def new_json_path(self, suffix: str = ".json") -> Path:
        return self.settings.json_dir / f"{uuid4().hex}{suffix}"

    def to_public_url(self, path: Path) -> str:
        relative = path.resolve().relative_to(self.settings.static_dir.resolve())
        parts = "/".join(relative.parts)
        return f"{self.settings.public_static_prefix}/{parts}"

    def model_status(self) -> dict[str, Any]:
        return {
            "translation_backend": self.settings.translation_backend,
            "retriever_ready": self.retriever is not None,
            "translator_ready": self.translator is not None,
            "ctc_ready": self.ctc_model is not None,
            "stt_ready": self.stt_model is not None,
            "word_db_entries": len(self.word_db),
            "word_db_path": str(self.settings.word_db_path),
            "label_index_entries": len(self.label_index),
        }

    @staticmethod
    def _load_label_index() -> dict[str, str]:
        label_index: dict[str, str] = {}
        for csv_path in (TRAIN_CSV, VAL_CSV):
            if not csv_path.exists():
                continue
            with open(csv_path, encoding="euc-kr", errors="replace") as handle:
                for row in csv.DictReader(handle):
                    stem = Path(row["Filename"]).stem
                    label_index[stem] = row["Kor"]
        return label_index
