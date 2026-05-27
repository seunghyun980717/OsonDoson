"""
글로스 시퀀스 -> 자연어 한국어 변환 (LLM few-shot)

LLM 우선순위:
  1. ollama 로컬 (gemma4, 항상 시도)
  2. OpenAI API (OPENAI_API_KEY 환경변수 있을 때)
  3. 단순 fallback
"""
import os
from typing import Optional

from app.ai_runtime.core.config import OPENAI_MODEL, OLLAMA_BASE_URL, OLLAMA_MODEL, TRANSLATION_BACKEND

_FEW_SHOT_EXAMPLES = [
    ("버스 곳 내리다 맞다",           "여기서 버스 내리는 게 맞나요?"),
    ("공항 버스 보다 전 곳 차내리다",  "공항 버스를 타기 전에 어디서 내려야 하나요?"),
    ("지하철 갈아타다 방법",           "지하철 환승은 어떻게 하나요?"),
    ("강남 가다 방법",                 "강남에 가는 방법이 무엇인가요?"),
    ("아이 실종 잃어버리다",           "아이를 잃어버렸어요."),
    ("서울대학교 길 찾다 방법",        "서울대학교 가는 길을 알려주세요."),
    ("여기 내리다 맞다",               "여기서 내리면 되나요?"),
    ("차밀리다 시간 괜찮다",           "차가 막혀서 시간이 괜찮을까요?"),
    ("유턴 맞다",                      "유턴해도 되나요?"),
    ("아파트 안 도착",                 "아파트에 아직 도착하지 못했어요."),
]

_SYSTEM_PROMPT = """당신은 한국 수어(KSL) 글로스를 자연스러운 한국어로 번역하는 전문가입니다.

규칙:
- KSL 글로스는 한국어와 어순이 다릅니다 (SOV 구조, 조사/어미 생략).
- 문맥에 맞는 자연스러운 구어체 한국어 문장으로 변환하세요.
- 번역된 문장만 출력하세요. 설명이나 다른 텍스트는 절대 출력하지 마세요."""


def _build_messages(gloss_str: str) -> list:
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for gloss, korean in _FEW_SHOT_EXAMPLES:
        messages.append({"role": "user",      "content": f"글로스: {gloss}"})
        messages.append({"role": "assistant", "content": korean})
    messages.append({"role": "user", "content": f"글로스: {gloss_str}"})
    return messages


def _call_openai_compat(messages: list, base_url: str, api_key: str, model: str) -> str:
    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.3,
        max_tokens=200,
    )
    content = resp.choices[0].message.content.strip()
    if not content:
        raise ValueError("LLM이 빈 응답 반환")
    return content.splitlines()[0].strip()


def _try_ollama(messages: list) -> Optional[str]:
    try:
        result = _call_openai_compat(
            messages,
            base_url=OLLAMA_BASE_URL,
            api_key="ollama",
            model=OLLAMA_MODEL,
        )
        return result
    except Exception as e:
        print(f"[gloss_to_korean] ollama 오류: {e}")
        return None


def _try_openai(messages: list) -> Optional[str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        return _call_openai_compat(
            messages,
            base_url="https://api.openai.com/v1",
            api_key=api_key,
            model=OPENAI_MODEL,
        )
    except Exception as e:
        print(f"[gloss_to_korean] OpenAI 오류: {e}")
        return None


def gloss_to_korean(gloss_str: str, model: Optional[str] = None) -> str:
    """글로스 시퀀스 문자열 -> 한국어 문장.
    백엔드는 config.TRANSLATION_BACKEND 로 결정:
      "t5"    → fine-tuned pko-t5-small
      "ollama"→ 로컬 ollama LLM
      "openai"→ OpenAI API
    """
    if not gloss_str.strip():
        return ""

    if TRANSLATION_BACKEND == "t5":
        from app.ai_runtime.core.seq2seq.infer import gloss_to_korean as t5_fn
        result = t5_fn(gloss_str)
        print(f"[gloss_to_korean] T5: {result}")
        return result or gloss_str

    messages = _build_messages(gloss_str)

    if TRANSLATION_BACKEND == "openai":
        result = _try_openai(messages)
        if result:
            print(f"[gloss_to_korean] OpenAI: {result}")
            return result

    else:  # "ollama" (기본)
        result = _try_ollama(messages)
        if result:
            print(f"[gloss_to_korean] ollama({OLLAMA_MODEL}): {result}")
            return result

    print("[gloss_to_korean] 백엔드 실패 → fallback")
    return " ".join(gloss_str.strip().split()) + "."
