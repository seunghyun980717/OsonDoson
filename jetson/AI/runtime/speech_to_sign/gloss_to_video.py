"""
Compose sign-language clips into a single output video.

The original project stored clip paths in ``word_db.json`` using machine-local
absolute Windows paths. This module now normalizes those paths so the same
database can be reused on Jetson, local development, and RunPod.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from core.config import GENERATED_WORD_CLIPS_DIR, OUTPUTS_DIR, WORD_CLIPS_DIR, WORD_DB_PATH, get_active_word_db_path
from core.data_utils.hangul_utils import text_to_jamo_seq

# Maps lowercase directory-segment names to their local base paths.
_CLIP_DIR_MAP = {
    "word_clips_generated": GENERATED_WORD_CLIPS_DIR,
    "word_clips": WORD_CLIPS_DIR,
}


def _resolve_clip_path(raw_path: str | Path) -> Path | None:
    # Normalize Windows backslash paths before constructing a Path object.
    normalized_str = str(raw_path).replace("\\", "/")
    candidate = Path(normalized_str)
    candidates = [candidate]

    # Try the filename alone under every known clips directory.
    if candidate.name:
        for base_dir in _CLIP_DIR_MAP.values():
            candidates.append(base_dir / candidate.name)

    # Walk the path parts and re-root at the matching local directory.
    parts = [part.lower() for part in candidate.parts]
    for segment, base_dir in _CLIP_DIR_MAP.items():
        if segment in parts:
            idx = parts.index(segment)
            remainder = Path(*candidate.parts[idx + 1 :])
            candidates.append(base_dir / remainder)

    seen: set[str] = set()
    for path in candidates:
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        if path.exists():
            return path
    return None


def _load_json_mapping(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _active_word_db_path() -> Path:
    return get_active_word_db_path()


def _active_jamo_db_path() -> Path:
    return _active_word_db_path().parent / "jamo_db.json"


def load_word_db(existing_only: bool = True) -> dict[str, str]:
    word_db_path = _active_word_db_path()
    if not word_db_path.exists():
        print(f"[gloss_to_video] word_db is missing: {word_db_path}")
        return {}

    raw_db = _load_json_mapping(word_db_path)
    resolved_db: dict[str, str] = {}
    missing = 0
    for gloss, raw_path in raw_db.items():
        resolved = _resolve_clip_path(raw_path)
        if resolved is not None:
            resolved_db[gloss] = str(resolved)
        elif not existing_only:
            resolved_db[gloss] = str(Path(raw_path))
        else:
            missing += 1

    print(
        "[gloss_to_video] word_db loaded: resolved={resolved} missing={missing}".format(
            resolved=len(resolved_db),
            missing=missing,
        )
    )
    return resolved_db


def load_jamo_db(existing_only: bool = True) -> dict[str, str]:
    raw_db = _load_json_mapping(_active_jamo_db_path())
    resolved_db: dict[str, str] = {}
    for token, raw_path in raw_db.items():
        resolved = _resolve_clip_path(raw_path)
        if resolved is not None:
            resolved_db[token] = str(resolved)
        elif not existing_only:
            resolved_db[token] = str(Path(raw_path))
    return resolved_db


def concat_clips(clip_paths: list[Path], output: Path) -> bool:
    if not clip_paths:
        return False

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as handle:
        for path in clip_paths:
            handle.write(f"file '{path.resolve()}'\n")
        list_file = Path(handle.name)

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(output),
    ]
    result = subprocess.run(command, capture_output=True)
    list_file.unlink(missing_ok=True)
    return result.returncode == 0


def _resolve_gloss_clips(gloss: str, word_db: dict[str, str], jamo_db: dict[str, str]) -> tuple[list[Path], str]:
    if gloss in word_db:
        path = Path(word_db[gloss])
        if path.exists():
            return [path], "word"

    if gloss in jamo_db:
        path = Path(jamo_db[gloss])
        if path.exists():
            return [path], "jamo_direct"

    if jamo_db:
        clips: list[Path] = []
        for token in text_to_jamo_seq(gloss):
            path_str = jamo_db.get(token)
            if not path_str:
                clips = []
                break
            path = Path(path_str)
            if not path.exists():
                clips = []
                break
            clips.append(path)
        if clips:
            return clips, "fingerspell"

    return [], "skip"


def collect_gloss_segments(
    glosses: list[str],
    *,
    word_db: dict[str, str] | None = None,
    jamo_db: dict[str, str] | None = None,
) -> dict[str, Any]:
    word_db = word_db or load_word_db()
    jamo_db = jamo_db or load_jamo_db()

    clip_paths: list[Path] = []
    resolved_glosses: list[str] = []
    missing_glosses: list[str] = []
    resolution_log: dict[str, list[str]] = {
        "word": [],
        "jamo_direct": [],
        "fingerspell": [],
        "skip": [],
    }

    for gloss in glosses:
        clips, method = _resolve_gloss_clips(gloss, word_db, jamo_db)
        resolution_log[method].append(gloss)
        if clips:
            clip_paths.extend(clips)
            resolved_glosses.append(gloss)
        else:
            missing_glosses.append(gloss)

    return {
        "clip_paths": clip_paths,
        "resolved_glosses": resolved_glosses,
        "missing_glosses": missing_glosses,
        "resolution_log": resolution_log,
    }


def glosses_to_video(
    glosses: list[str],
    output: Path | None = None,
    word_db: dict[str, str] | None = None,
    jamo_db: dict[str, str] | None = None,
) -> Path | None:
    plan = collect_gloss_segments(glosses, word_db=word_db, jamo_db=jamo_db)
    if not plan["clip_paths"]:
        print("[gloss_to_video] no clips resolved for the requested glosses")
        return None

    output = output or Path(tempfile.mktemp(suffix=".mp4"))
    output.parent.mkdir(parents=True, exist_ok=True)
    ok = concat_clips(plan["clip_paths"], output)
    if not ok:
        print("[gloss_to_video] ffmpeg concat failed")
        return None

    print(
        "[gloss_to_video] built={output} resolved={resolved} missing={missing}".format(
            output=output,
            resolved=len(plan["resolved_glosses"]),
            missing=len(plan["missing_glosses"]),
        )
    )
    return output


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--glosses", required=True, help="Space-separated gloss sequence.")
    parser.add_argument("--output", type=Path, default=OUTPUTS_DIR / "output_sign.mp4")
    args = parser.parse_args()

    result = glosses_to_video(glosses=args.glosses.split(), output=args.output)
    print(f"Output: {result}")
