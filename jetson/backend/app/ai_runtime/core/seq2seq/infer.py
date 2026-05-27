"""
Inference-only T5 translator shared by runtime and research code.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import torch

# 백엔드 경로에 맞게 수정: core -> app.ai_runtime.core
from app.ai_runtime.core.config import SEQ2SEQ_MODEL_DIR

GLOSS_TO_KO_PREFIX = "글로스를 한국어로 번역: "
KO_TO_GLOSS_PREFIX = "한국어를 글로스로 변환: "


class GlossTranslator:
    """Load the fine-tuned T5 model once and reuse it for inference."""

    def __init__(self, model_dir: Optional[Path] = None):
        from transformers import AutoTokenizer, T5ForConditionalGeneration

        model_dir = model_dir or (SEQ2SEQ_MODEL_DIR / "best")
        if not model_dir.exists():
            raise FileNotFoundError(
                f"Trained seq2seq model not found: {model_dir}\n"
                "Run: python -m poc.seq2seq.train"
            )

        print(f"[GlossTranslator] model load: {model_dir}")
        self.tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
        self.model = T5ForConditionalGeneration.from_pretrained(str(model_dir))
        
        # 최신 AI 엔진의 '자원 절약' 모드 반영: GPU 대신 CPU 고정 사용
        self.device = "cpu"
        
        self.model.to(self.device).eval()
        print(f"[GlossTranslator] ready ({self.device})")

    def _generate(self, text: str, max_length: int = 128) -> str:
        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            max_length=128,
            truncation=True,
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_length=max_length,
                num_beams=4,
                early_stopping=True,
                no_repeat_ngram_size=3,
            )
        return self.tokenizer.decode(outputs[0], skip_special_tokens=True).strip()

    def gloss_to_korean(self, gloss_str: str) -> str:
        if not gloss_str.strip():
            return ""
        return self._generate(GLOSS_TO_KO_PREFIX + gloss_str.strip())

    def korean_to_gloss_str(self, korean: str) -> str:
        if not korean.strip():
            return ""
        return self._generate(KO_TO_GLOSS_PREFIX + korean.strip())

    def korean_to_gloss(
        self,
        korean: str,
        word_db_glosses: Optional[set[str]] = None,
    ) -> List[str]:
        raw = self.korean_to_gloss_str(korean)
        tokens = raw.strip().split()
        if word_db_glosses:
            tokens = [token for token in tokens if token in word_db_glosses]
        return tokens


_translator: Optional[GlossTranslator] = None


def _get_translator() -> GlossTranslator:
    global _translator
    if _translator is None:
        _translator = GlossTranslator()
    return _translator


def gloss_to_korean(gloss_str: str) -> str:
    return _get_translator().gloss_to_korean(gloss_str)


def korean_to_gloss(korean: str, word_db_glosses: Optional[set[str]] = None) -> List[str]:
    return _get_translator().korean_to_gloss(korean, word_db_glosses)
