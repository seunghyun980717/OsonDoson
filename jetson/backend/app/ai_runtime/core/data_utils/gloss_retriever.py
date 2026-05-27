"""
RAG용 글로스 임베딩 DB 및 유사도 검색

흐름:
  1. 324개 글로스를 sentence-transformers로 임베딩 → 캐시 저장
  2. 입력 한국어를 동일 모델로 임베딩
  3. 코사인 유사도 상위 k개 글로스 반환 (threshold 미만 제거)

임베딩 모델: jhgan/ko-sroberta-multitask (한국어 특화, 117MB)
fallback:    ollama embed (노모델 없을 때)
"""
import json
from pathlib import Path
from typing import List, Tuple

import numpy as np

from app.ai_runtime.core.config import CACHE_DIR, OLLAMA_BASE_URL, OLLAMA_MODEL, WORD_DB_PATH

EMBED_CACHE = CACHE_DIR / "gloss_embeddings.npz"
EMBED_MODEL  = "jhgan/ko-sroberta-multitask"

_st_model = None  # SentenceTransformer 싱글톤


# ── 임베딩 함수 ──────────────────────────────────────────────────────────

def _embed_sentence_transformers(texts: List[str]) -> np.ndarray:
    global _st_model
    from sentence_transformers import SentenceTransformer
    if _st_model is None:
        _st_model = SentenceTransformer(EMBED_MODEL)
    return _st_model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def _embed_ollama(texts: List[str]) -> np.ndarray:
    """ollama /api/embeddings 사용 (sentence-transformers 없을 때 fallback)"""
    import urllib.request
    vecs = []
    for text in texts:
        body = json.dumps({"model": OLLAMA_MODEL, "prompt": text}).encode()
        req  = urllib.request.Request(
            OLLAMA_BASE_URL.replace("/v1", "") + "/api/embeddings",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        vecs.append(data["embedding"])
    arr = np.array(vecs, dtype=np.float32)
    # L2 정규화
    norms = np.linalg.norm(arr, axis=1, keepdims=True).clip(min=1e-9)
    return arr / norms


def embed(texts: List[str]) -> np.ndarray:
    try:
        return _embed_sentence_transformers(texts)
    except ImportError:
        print("[gloss_retriever] sentence-transformers 없음 → ollama embed fallback")
        return _embed_ollama(texts)


# ── 글로스 DB 구축 ────────────────────────────────────────────────────────

def _load_glosses() -> List[str]:
    """word_db에 실제 클립이 있는 글로스만 로드 (클립 없으면 RAG 후보 제외)"""
    if not WORD_DB_PATH.exists():
        raise FileNotFoundError(
            "word_db.json 없음. 먼저 실행:\n"
            "  python -m data_utils.word_db_builder\n"
            "  python -m data_utils.sentence_gloss_db_builder"
        )
    with open(WORD_DB_PATH, encoding="utf-8") as f:
        db = json.load(f)
    # 실제 파일이 존재하는 것만
    return [g for g, path in db.items() if Path(path).exists()]


def build_gloss_index(force: bool = False) -> Tuple[List[str], np.ndarray]:
    """
    글로스 임베딩 인덱스 빌드 및 캐시.
    word_db 기준 (실제 클립이 있는 글로스만 포함).

    Returns:
        glosses:    ["가다", "가방", ...]  (N,)
        embeddings: float32 (N, D) - L2 정규화됨
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # word_db가 캐시보다 최신이면 재빌드
    db_mtime    = WORD_DB_PATH.stat().st_mtime if WORD_DB_PATH.exists() else 0
    cache_mtime = EMBED_CACHE.stat().st_mtime  if EMBED_CACHE.exists()  else 0
    cache_stale = db_mtime > cache_mtime

    if EMBED_CACHE.exists() and not force and not cache_stale:
        data    = np.load(EMBED_CACHE, allow_pickle=True)
        glosses = data["glosses"].tolist()
        vecs    = data["embeddings"]
        print(f"[gloss_retriever] 캐시 로드: {len(glosses)}개 글로스 (클립 보유)")
        return glosses, vecs

    if cache_stale:
        print("[gloss_retriever] word_db 갱신 감지 → 인덱스 재빌드")

    glosses = _load_glosses()
    print(f"[gloss_retriever] 글로스 {len(glosses)}개 임베딩 중...")
    vecs = embed(glosses)
    np.savez(EMBED_CACHE, glosses=np.array(glosses), embeddings=vecs)
    print(f"[gloss_retriever] 저장 완료: {EMBED_CACHE}")
    return glosses, vecs


# ── 유사도 검색 ───────────────────────────────────────────────────────────

class GlossRetriever:
    def __init__(self, threshold: float = 0.35, top_k: int = 10):
        """
        Args:
            threshold: 코사인 유사도 최솟값. 이하는 후보에서 제외.
                       0.35: 의미적으로 관련 있는 것만 허용.
            top_k:     최대 후보 수.
        """
        self.threshold = threshold
        self.top_k     = top_k
        self.glosses, self.vecs = build_gloss_index()

    def retrieve(self, korean: str) -> List[Tuple[str, float]]:
        """
        Args:
            korean: 입력 한국어 문장

        Returns:
            [(gloss, score), ...] - score 내림차순, threshold 이상만
        """
        query_vec = embed([korean])[0]  # (D,)
        scores    = self.vecs @ query_vec  # (N,) 코사인 유사도

        top_idx = np.argsort(scores)[::-1][:self.top_k]
        results = [
            (self.glosses[i], float(scores[i]))
            for i in top_idx
            if scores[i] >= self.threshold
        ]
        return results

    def retrieve_glosses(self, korean: str) -> List[str]:
        """후보 글로스 리스트만 반환"""
        return [g for g, _ in self.retrieve(korean)]


# ── 단독 실행 (인덱스 빌드) ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--query",   type=str, default="지하철 환승은 어떻게 하나요?")
    args = parser.parse_args()

    retriever = GlossRetriever()
    if args.rebuild:
        build_gloss_index(force=True)

    results = retriever.retrieve(args.query)
    print(f"\n쿼리: {args.query}")
    print("후보 글로스:")
    for gloss, score in results:
        print(f"  {gloss:15s}  {score:.3f}")
