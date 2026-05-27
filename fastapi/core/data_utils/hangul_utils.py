"""
한글 자모 분해 유틸리티

지문자(finger-spelling) 폴백에서 사용.
한글 음절을 초성·중성·종성으로 분해하여 지문자 클립 시퀀스로 변환.

사용:
    from data_utils.hangul_utils import syllable_to_jamo, text_to_jamo_seq

참고:
    한글 음절 유니코드 = (초성×21 + 중성)×28 + 종성 + 0xAC00
"""

# 초성 (19개)
CHOSUNG = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

# 중성 (21개)
JUNGSUNG = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ',
    'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
]

# 종성 (28개, 0번째는 없음)
JONGSUNG = [
    '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ',
    'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ',
    'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]

# 겹자음/겹모음 → 단순 자모로 분해 (지문자에 없는 경우 대체)
COMPOUND_MAP = {
    # 겹받침 → 기본 자음 2개
    'ㄳ': ('ㄱ', 'ㅅ'),
    'ㄵ': ('ㄴ', 'ㅈ'),
    'ㄶ': ('ㄴ', 'ㅎ'),
    'ㄺ': ('ㄹ', 'ㄱ'),
    'ㄻ': ('ㄹ', 'ㅁ'),
    'ㄼ': ('ㄹ', 'ㅂ'),
    'ㄽ': ('ㄹ', 'ㅅ'),
    'ㄾ': ('ㄹ', 'ㅌ'),
    'ㄿ': ('ㄹ', 'ㅍ'),
    'ㅀ': ('ㄹ', 'ㅎ'),
    'ㅄ': ('ㅂ', 'ㅅ'),
    # 겹모음 → 단순 모음 2개
    'ㅘ': ('ㅗ', 'ㅏ'),
    'ㅙ': ('ㅗ', 'ㅐ'),
    'ㅚ': ('ㅗ', 'ㅣ'),
    'ㅝ': ('ㅜ', 'ㅓ'),
    'ㅞ': ('ㅜ', 'ㅔ'),
    'ㅟ': ('ㅜ', 'ㅣ'),
    'ㅢ': ('ㅡ', 'ㅣ'),
    # 쌍자음 → 기본 자음 반복
    'ㄲ': ('ㄱ', 'ㄱ'),
    'ㄸ': ('ㄷ', 'ㄷ'),
    'ㅃ': ('ㅂ', 'ㅂ'),
    'ㅆ': ('ㅅ', 'ㅅ'),
    'ㅉ': ('ㅈ', 'ㅈ'),
}

# 숫자 → 지숫자 키 (word_db에서 쓸 키 이름)
DIGIT_MAP = {
    '0': '영', '1': '일', '2': '이', '3': '삼', '4': '사',
    '5': '오', '6': '육', '7': '칠', '8': '팔', '9': '구',
}

HANGUL_BASE = 0xAC00
HANGUL_END  = 0xD7A3


def is_hangul_syllable(ch: str) -> bool:
    return HANGUL_BASE <= ord(ch) <= HANGUL_END


def syllable_to_jamo(ch: str) -> list[str]:
    """
    한글 음절 1자 → 초성·중성·종성 자모 리스트.

    예) '강' → ['ㄱ', 'ㅏ', 'ㅇ']
        '의' → ['ㅇ', 'ㅢ'] (종성 없음)
        '닭' → ['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ']  (겹받침 분해)
    """
    if not is_hangul_syllable(ch):
        return [ch]  # 비한글은 그대로

    code   = ord(ch) - HANGUL_BASE
    cho    = code // (21 * 28)
    jung   = (code % (21 * 28)) // 28
    jong   = code % 28

    result = []

    # 초성
    cho_char = CHOSUNG[cho]
    result.extend(COMPOUND_MAP.get(cho_char, (cho_char,)) if cho_char in COMPOUND_MAP else [cho_char])

    # 중성
    jung_char = JUNGSUNG[jung]
    result.extend(COMPOUND_MAP.get(jung_char, (jung_char,)) if jung_char in COMPOUND_MAP else [jung_char])

    # 종성 (있을 때만)
    if jong:
        jong_char = JONGSUNG[jong]
        result.extend(COMPOUND_MAP.get(jong_char, (jong_char,)) if jong_char in COMPOUND_MAP else [jong_char])

    return result


def text_to_jamo_seq(text: str) -> list[str]:
    """
    문자열 → 지문자/지숫자 키 시퀀스.

    예) '선생님' → ['ㅅ','ㅓ','ㄴ','ㅅ','ㅐ','ㅇ','ㄴ','ㅣ','ㅁ']
        '119'   → ['일','일','구']
        'KSL'   → ['K','S','L']  (알파벳은 그대로)
    """
    result = []
    for ch in text:
        if ch.isdigit():
            result.append(DIGIT_MAP.get(ch, ch))
        elif is_hangul_syllable(ch):
            result.extend(syllable_to_jamo(ch))
        else:
            result.append(ch)  # 영문, 기호 등 그대로
    return result
