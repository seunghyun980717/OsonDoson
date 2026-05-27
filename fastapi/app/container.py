from __future__ import annotations

import csv
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.settings import AppSettings
from core.config import TRAIN_CSV, VAL_CSV

logger = logging.getLogger(__name__)
GLOSS_RECOMMEND_BASE_DIR = Path("/workspace/fastapi/data")


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
    recommend_bigram_table: dict[str, Any] | None = None
    recommend_trigram_table: dict[str, Any] | None = None
    recommend_starter_table: dict[str, Any] | None = None
    recommend_w2v_model: object | None = None

    def startup(self) -> None:
        from runtime.sign_to_speech.infer import get_runtime_device_info
        from runtime.speech_to_sign.gloss_to_video import load_word_db

        started = time.perf_counter()
        logger.info("애플리케이션 startup을 시작합니다.")

        self.device_info = get_runtime_device_info()
        logger.info("device 정보를 불러왔습니다.")

        self.word_db = load_word_db()
        logger.info("word_db를 불러왔습니다. entry 수=%s", len(self.word_db))

        self.label_index = self._load_label_index()
        logger.info("label index를 불러왔습니다. entry 수=%s", len(self.label_index))

        if self.settings.preload_models:
            logger.info("preload_models=True 이므로 모델 사전 로드를 시작합니다.")

            self.get_retriever()
            logger.info("retriever를 사전 로드했습니다.")

            self.get_translator()
            logger.info("translator를 사전 로드했습니다.")

            self.get_ctc_model()
            logger.info("ctc 모델을 사전 로드했습니다.")

            self.get_stt_model()
            logger.info("stt 모델을 사전 로드했습니다.")

            self.get_gloss_recommend_resources()
            logger.info("gloss recommend 모델을 사전 로드했습니다.")

            logger.info("모델 사전 로드를 완료했습니다.")

        elapsed = time.perf_counter() - started
        logger.info(
            "startup이 완료되었습니다. profile=%s backend=%s clips=%s word_db=%s preload=%s elapsed=%.2fs",
            self.settings.profile.name,
            self.settings.translation_backend,
            len(self.word_db),
            self.settings.word_db_path.name,
            self.settings.preload_models,
            elapsed,
        )

    def get_word_db(self) -> dict[str, str]:
        if not self.word_db:
            from runtime.speech_to_sign.gloss_to_video import load_word_db

            self.word_db = load_word_db()
        return self.word_db

    def get_retriever(self) -> object | None:
        if self.settings.translation_backend not in {"ollama", "openai"}:
            return None
        if self.retriever is None:
            from core.data_utils.gloss_retriever import GlossRetriever

            self.retriever = GlossRetriever()
        return self.retriever

    def get_translator(self) -> object | None:
        if self.settings.translation_backend != "t5":
            return None
        if self.translator is None:
            from core.seq2seq.infer import _get_translator

            self.translator = _get_translator()
        return self.translator

    def get_ctc_model(self) -> tuple[object, object]:
        if self.ctc_model is None or self.ctc_vocab is None:
            from runtime.sign_to_speech.infer import load_model

            self.ctc_model, self.ctc_vocab = load_model()
        return self.ctc_model, self.ctc_vocab

    def get_stt_model(self) -> object:
        if not self.settings.enable_stt:
            raise RuntimeError("STT is disabled for this profile.")
        if self.stt_model is None:
            from runtime.speech_to_sign.stt import load_model

            self.stt_model = load_model("small")
        return self.stt_model

    def get_gloss_recommend_resources(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], object]:
        if self.recommend_bigram_table is None:
            with open(GLOSS_RECOMMEND_BASE_DIR / "bigram.json", "r", encoding="utf-8") as handle:
                self.recommend_bigram_table = json.load(handle)

        if self.recommend_trigram_table is None:
            with open(GLOSS_RECOMMEND_BASE_DIR / "trigram.json", "r", encoding="utf-8") as handle:
                self.recommend_trigram_table = json.load(handle)

        if self.recommend_starter_table is None:
            with open(GLOSS_RECOMMEND_BASE_DIR / "starter.json", "r", encoding="utf-8") as handle:
                self.recommend_starter_table = json.load(handle)

        if self.recommend_w2v_model is None:
            from gensim.models import Word2Vec

            self.recommend_w2v_model = Word2Vec.load(str(GLOSS_RECOMMEND_BASE_DIR / "word2vec.model"))

        return (
            self.recommend_bigram_table,
            self.recommend_trigram_table,
            self.recommend_starter_table,
            self.recommend_w2v_model,
        )

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
