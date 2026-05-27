"""
한국어 텍스트 -> 글로스 시퀀스

RAG + LLM (gemma4 via ollama) 방식:
  1. 입력 한국어를 임베딩
  2. 글로스 DB에서 유사 후보 검색 (threshold 이상만)
  3. 후보 글로스만 LLM에 전달 -> 시퀀스 생성
     → 출력이 항상 DB 내 글로스로 구성됨 (hallucination 방지)

KSL 문법 변환은 현재 미지원 (few-shot 패턴 수준).
추후 AIHUB morpheme 데이터로 seq2seq fine-tuning 예정.

LLM 우선순위: ollama(gemma4) -> OpenAI -> fallback
"""
import os
from typing import List, Optional, Tuple

from app.ai_runtime.core.config import (
    OPENAI_MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    TRANSLATION_BACKEND,
    VOCAB_PATH,
    get_active_word_db_path,
)

_FEW_SHOT_EXAMPLES = [
    ("여기서 버스 내리는 게 맞나요?",              "버스 곳 내리다 맞다"),
    ("공항 버스를 타기 전에 어디서 내려야 하나요?", "공항 버스 전 곳 차내리다"),
    ("지하철 환승은 어떻게 하나요?",               "지하철 갈아타다 방법"),
    ("강남에 가는 방법이 무엇인가요?",             "강남 가다 방법"),
    ("아이를 잃어버렸어요.",                       "아이 실종 잃어버리다"),
    ("여기서 내리면 되나요?",                      "여기 내리다 맞다"),
    ("병원이 어디 있나요?",                        "병원 곳 어디"),
    ("버스 정류장이 어디예요?",                    "버스 곳 어디"),
]

_SYSTEM_PROMPT = """당신은 한국어를 한국 수어(KSL) 글로스 시퀀스로 변환하는 전문가입니다.

규칙:
- 반드시 아래 [사용 가능한 글로스] 목록에 있는 단어만 사용하세요.
- 목록에 없는 단어는 절대 출력하지 마세요.
- 조사와 어미는 제거하고, 동사는 기본형으로 쓰세요 (예: 갑니다 -> 가다).
- 글로스를 공백으로 구분된 한 줄로만 출력하세요. 설명은 출력하지 마세요."""


def _build_messages(korean: str, candidates: List[Tuple[str, float]]) -> list:
    candidate_str = ", ".join(f"{g}({s:.2f})" for g, s in candidates)
    system = _SYSTEM_PROMPT + f"\n\n[사용 가능한 글로스] (괄호 안은 유사도)\n{candidate_str}"

    messages = [{"role": "system", "content": system}]
    for k, g in _FEW_SHOT_EXAMPLES:
        messages.append({"role": "user",      "content": k})
        messages.append({"role": "assistant", "content": g})
    messages.append({"role": "user", "content": korean})
    return messages


def _call_llm(messages: list, base_url: str, api_key: str, model: str) -> str:
    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.1,
        max_tokens=80,
    )
    content = resp.choices[0].message.content.strip()
    if not content:
        raise ValueError("LLM이 빈 응답 반환")
    return content.splitlines()[0].strip()


def _try_ollama(messages: list) -> Optional[str]:
    try:
        return _call_llm(messages, OLLAMA_BASE_URL, "ollama", OLLAMA_MODEL)
    except Exception as e:
        print(f"[korean_to_gloss] ollama 오류: {e}")
        return None


def _try_openai(messages: list) -> Optional[str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        return _call_llm(messages, "https://api.openai.com/v1", api_key, OPENAI_MODEL)
    except Exception as e:
        print(f"[korean_to_gloss] OpenAI 오류: {e}")
        return None


def _load_full_vocab() -> set:
    """vocab.json 전체 글로스 로드 (blank/unk 제외)"""
    import json
    if not VOCAB_PATH.exists():
        return set()
    with open(VOCAB_PATH, encoding="utf-8") as f:
        tokens = json.load(f)
    return {t for t in tokens if not t.startswith("<")}


def _filter_to_vocab(raw: str) -> List[str]:
    """LLM 출력에서 vocab에 있는 글로스만 통과 (RAG 후보 제한 없음)"""
    vocab = _load_full_vocab()
    return [g for g in raw.split() if g in vocab]


def korean_to_gloss(
    korean: str,
    retriever=None,
    top_k: int = 12,
    threshold: float = 0.35,
) -> List[str]:
    """
    한국어 문장 -> 글로스 리스트.

    Args:
        korean:    입력 한국어 문장
        retriever: GlossRetriever 인스턴스 (None이면 자동 생성)
        top_k:     RAG 후보 수
        threshold: 유사도 최솟값

    Returns:
        ["지하철", "갈아타다", "방법"]  <- 항상 DB 내 글로스
    """
    if not korean.strip():
        return []

    print(f"[korean_to_gloss] 입력: {korean!r}")

    # ── T5 백엔드: RAG 스킵 (T5가 독립적으로 생성, RAG는 시간낭비) ──────────
    if TRANSLATION_BACKEND == "t5":
        try:
            from app.ai_runtime.core.seq2seq.infer import _get_translator
            import json
            with open(get_active_word_db_path(), encoding='utf-8') as f:
                db_glosses = set(json.load(f).keys())

            raw = _get_translator().korean_to_gloss_str(korean)
            print(f"[korean_to_gloss] T5 raw: {raw!r}")

            filtered = [t for t in raw.strip().split() if t in db_glosses]
            print(f"[korean_to_gloss] T5 filtered: {filtered}")

            if filtered:
                return filtered

            # T5 결과가 전부 word_db 밖 → 빈 리스트 반환 (RAG fallback 안 함)
            print(f"[korean_to_gloss] T5 결과 없음 (word_db 미보유 어휘)")
            return []

        except Exception as e:
            print(f"[korean_to_gloss] T5 실패: {e}")
            return []

    # ── LLM 백엔드: RAG 필수 (후보를 프롬프트에 주입) ───────────────────────
    if retriever is None:
        from app.ai_runtime.core.data_utils.gloss_retriever import GlossRetriever
        retriever = GlossRetriever(threshold=threshold, top_k=top_k)

    candidates = retriever.retrieve(korean)  # [(gloss, score), ...]

    if not candidates:
        print(f"[korean_to_gloss] 유사도 {threshold} 이상 후보 없음 → fallback")
        return _fallback(korean, retriever)

    candidate_glosses = [g for g, _ in candidates]
    print(f"[korean_to_gloss] RAG 후보: {candidate_glosses}")

    # LLM으로 시퀀스 생성
    messages = _build_messages(korean, candidates)

    if TRANSLATION_BACKEND == "openai":
        raw = _try_openai(messages)
    else:  # "ollama" (기본)
        raw = _try_ollama(messages)

    if not raw:
        print("[korean_to_gloss] LLM 없음 → 후보 상위 3개 반환")
        return candidate_glosses[:3]

    print(f"[korean_to_gloss] LLM 출력: {raw!r}")

    # vocab 전체 기준으로 필터 (RAG 후보 제한 없음)
    filtered = _filter_to_vocab(raw)

    if not filtered:
        # LLM이 vocab 완전 이탈 시 RAG 유사도 상위로 대체
        print("[korean_to_gloss] vocab 이탈 감지 → RAG 상위 반환")
        return candidate_glosses[:3]

    return filtered


def _fallback(korean: str, retriever) -> List[str]:
    """threshold 미만이거나 retriever 실패 시: 유사도 무시하고 top-3만"""
    prev_threshold = getattr(retriever, "threshold", 0.35)
    try:
        retriever.threshold = 0.0
        candidates = retriever.retrieve(korean)
    finally:
        retriever.threshold = prev_threshold
    return [g for g, _ in candidates[:3]]
