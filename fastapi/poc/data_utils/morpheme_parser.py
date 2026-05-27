"""
AIHUB morpheme JSON (zip) → 글로스 + 프레임 구간 목록

morpheme JSON 구조:
  {
    "metaData": {"duration": 9.3, ...},
    "data": [
      {"start": 2.344, "end": 2.994, "attributes": [{"name": "버스"}]},
      ...
    ]
  }
"""
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import FPS


@dataclass
class GlossSegment:
    gloss: str
    start_sec: float
    end_sec: float
    start_frame: int
    end_frame: int


def parse_morpheme(data: dict) -> List[GlossSegment]:
    segments = []
    for item in data.get("data", []):
        gloss = item["attributes"][0]["name"]
        s, e = item["start"], item["end"]
        segments.append(GlossSegment(
            gloss=gloss,
            start_sec=s,
            end_sec=e,
            start_frame=int(s * FPS),
            end_frame=int(e * FPS),
        ))
    return segments


def load_morpheme_from_zip(
    zip_path: Path,
    video_name: str,
    *,
    top_folder: Optional[str] = None,
    is_word: bool = False,
) -> Optional[List[GlossSegment]]:
    """
    zip에서 video_name의 morpheme 파일을 읽어 GlossSegment 목록 반환.

    Args:
        zip_path: morpheme zip 파일
        video_name: 'NIA_SL_SEN0001_REAL01_F' 또는 'NIA_SL_WORD0001_REAL17_F'
        top_folder: 자동 추론하려면 None
        is_word: word 데이터면 True (파일명에 _morpheme.json 붙는 방식 동일)
    """
    if top_folder is None:
        m = re.search(r"REAL(\d+)", video_name)
        top_folder = m.group(1) if m else "01"

    # sentence: morpheme/01/NIA_SL_SEN0001_REAL01_F_morpheme.json
    # word:     morpheme/17/NIA_SL_WORD0001_REAL17_F_morpheme.json
    inner_path = f"morpheme/{top_folder}/{video_name}_morpheme.json"

    # val word morpheme zip은 다른 경로 없이 바로 morpheme/ 하위
    alt_path = f"{video_name}_morpheme.json"

    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            if inner_path in names:
                data = json.loads(zf.read(inner_path))
            else:
                # fallback: 파일명으로 검색
                matches = [n for n in names if n.endswith(f"{video_name}_morpheme.json")]
                if not matches:
                    return None
                data = json.loads(zf.read(matches[0]))

        return parse_morpheme(data)

    except Exception as e:
        print(f"[morpheme_parser] {video_name}: {e}")
        return None


def get_gloss_sequence(segments: List[GlossSegment]) -> List[str]:
    return [s.gloss for s in segments]
