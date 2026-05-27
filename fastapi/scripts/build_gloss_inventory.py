"""
Build a deduplicated gloss inventory from the runtime dictionary and the full
malmoongchi corpus.

This script does not overwrite ``word_db.json`` because most malmoongchi glosses
do not have a matching video clip yet. Instead it produces:

- ``data/derived/gloss_inventory.json``
- ``data/derived/gloss_inventory_report.json``

Each inventory entry tracks whether a runtime clip exists and where the gloss
was observed.
"""

from __future__ import annotations

import argparse
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import sys

LKS_DIR = Path(__file__).resolve().parents[1]
if str(LKS_DIR) not in sys.path:
    sys.path.insert(0, str(LKS_DIR))

from core.config import (
    GLOSS_INVENTORY_PATH,
    GLOSS_INVENTORY_REPORT_PATH,
    MALMOONGCHI_DIR,
    WORD_CLIPS_DIR,
    WORD_DB_PATH,
)


def normalize_gloss_token(token: str) -> str:
    return " ".join(
        token.replace("／", "/")
        .replace("_", " ")
        .replace("·", "")
        .replace("|", "")
        .strip()
        .split()
    )


def resolve_runtime_clip(raw_path: str) -> str | None:
    candidate = Path(raw_path)
    candidates = [candidate]

    if candidate.name:
        candidates.append(WORD_CLIPS_DIR / candidate.name)

    parts = [part.lower() for part in candidate.parts]
    if "word_clips" in parts:
        index = parts.index("word_clips")
        remainder = Path(*candidate.parts[index + 1 :])
        candidates.append(WORD_CLIPS_DIR / remainder)

    seen: set[str] = set()
    for path in candidates:
        normalized = Path(path)
        key = str(normalized).lower()
        if key in seen:
            continue
        seen.add(key)
        if normalized.exists():
            return str(normalized)
    return None


def load_runtime_dictionary() -> dict[str, dict[str, Any]]:
    if not WORD_DB_PATH.exists():
        return {}
    with open(WORD_DB_PATH, encoding="utf-8") as handle:
        raw_db = json.load(handle)

    inventory: dict[str, dict[str, Any]] = {}
    for gloss, raw_path in raw_db.items():
        clip_path = resolve_runtime_clip(str(raw_path))
        inventory[gloss] = {
            "gloss": gloss,
            "sources": ["word_db"],
            "sample_count": 0,
            "has_clip": clip_path is not None,
            "clip_path": clip_path,
            "example_refs": [],
        }
    return inventory


def extract_malmoongchi_tokens(payload: dict[str, Any]) -> list[str]:
    sign_script = payload.get("sign_script") or {}
    gestures = sign_script.get("sign_gestures_strong") or []
    timed_tokens: list[tuple[float, str]] = []
    for gesture in gestures:
        token = normalize_gloss_token(str(gesture.get("gloss_id") or ""))
        if not token:
            continue
        start = float(gesture.get("start", 0.0) or 0.0)
        timed_tokens.append((start, token))
    if timed_tokens:
        return [token for _, token in sorted(timed_tokens, key=lambda item: item[0])]

    raw = str(payload.get("sign_lang_sntenc") or "")
    return [token for token in (normalize_gloss_token(part) for part in raw.replace("/", " ").split()) if token]


def merge_malmoongchi_glosses(
    inventory: dict[str, dict[str, Any]],
    limit_files: int | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not MALMOONGCHI_DIR.exists():
        raise FileNotFoundError(f"malmoongchi directory not found: {MALMOONGCHI_DIR}")

    sample_counter = Counter()
    zip_counter = Counter()
    processed = 0

    for zip_path in sorted(MALMOONGCHI_DIR.glob("*.zip")):
        with zipfile.ZipFile(zip_path) as archive:
            for member in sorted(name for name in archive.namelist() if name.endswith(".json")):
                if limit_files is not None and processed >= limit_files:
                    report = {
                        "processed_json_files": processed,
                        "zip_counter": dict(zip_counter),
                    }
                    return inventory, report

                payload = json.loads(archive.read(member).decode("utf-8-sig"))
                tokens = extract_malmoongchi_tokens(payload)
                if not tokens:
                    processed += 1
                    zip_counter[zip_path.name] += 1
                    continue

                sample_id = str(payload.get("id") or member)
                for token in tokens:
                    sample_counter[token] += 1
                    entry = inventory.get(token)
                    if entry is None:
                        entry = {
                            "gloss": token,
                            "sources": ["malmoongchi"],
                            "sample_count": 0,
                            "has_clip": False,
                            "clip_path": None,
                            "example_refs": [],
                        }
                        inventory[token] = entry
                    elif "malmoongchi" not in entry["sources"]:
                        entry["sources"].append("malmoongchi")

                    entry["sample_count"] += 1
                    if len(entry["example_refs"]) < 3:
                        entry["example_refs"].append(
                            {
                                "sample_id": sample_id,
                                "zip_file": zip_path.name,
                                "member": member,
                            }
                        )

                processed += 1
                zip_counter[zip_path.name] += 1

    report = {
        "processed_json_files": processed,
        "zip_counter": dict(zip_counter),
        "sample_counter_top20": sample_counter.most_common(20),
    }
    return inventory, report


def build_report(inventory: dict[str, dict[str, Any]], ingest_report: dict[str, Any]) -> dict[str, Any]:
    source_counter = Counter()
    with_clip = 0
    without_clip = 0
    only_runtime = 0
    only_malmoongchi = 0
    both_sources = 0

    for entry in inventory.values():
        sources = set(entry["sources"])
        for source in sources:
            source_counter[source] += 1
        if entry["has_clip"]:
            with_clip += 1
        else:
            without_clip += 1

        if sources == {"word_db"}:
            only_runtime += 1
        elif sources == {"malmoongchi"}:
            only_malmoongchi += 1
        else:
            both_sources += 1

    missing_clip_examples = sorted(
        (entry for entry in inventory.values() if not entry["has_clip"]),
        key=lambda item: (-int(item["sample_count"]), item["gloss"]),
    )[:100]

    return {
        "ingest": ingest_report,
        "summary": {
            "total_glosses": len(inventory),
            "with_clip": with_clip,
            "without_clip": without_clip,
            "only_runtime": only_runtime,
            "only_malmoongchi": only_malmoongchi,
            "both_sources": both_sources,
            "sources": dict(source_counter),
        },
        "top_missing_clip_glosses": [
            {
                "gloss": entry["gloss"],
                "sample_count": entry["sample_count"],
                "sources": entry["sources"],
            }
            for entry in missing_clip_examples
        ],
    }


def save_inventory(inventory: dict[str, dict[str, Any]], report: dict[str, Any]) -> None:
    GLOSS_INVENTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    ordered_inventory = dict(sorted(inventory.items(), key=lambda item: item[0]))
    with open(GLOSS_INVENTORY_PATH, "w", encoding="utf-8") as handle:
        json.dump(ordered_inventory, handle, ensure_ascii=False, indent=2)
    with open(GLOSS_INVENTORY_REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-files", type=int, default=None)
    args = parser.parse_args()

    inventory = load_runtime_dictionary()
    inventory, ingest_report = merge_malmoongchi_glosses(inventory, limit_files=args.limit_files)
    report = build_report(inventory, ingest_report)
    save_inventory(inventory, report)

    summary = report["summary"]
    print(
        "[gloss_inventory] total={total_glosses} with_clip={with_clip} without_clip={without_clip}".format(
            **summary
        )
    )
    print(
        "[gloss_inventory] runtime_only={only_runtime} malmoongchi_only={only_malmoongchi} both={both_sources}".format(
            **summary
        )
    )
    print(f"[gloss_inventory] saved: {GLOSS_INVENTORY_PATH}")
    print(f"[gloss_inventory] report: {GLOSS_INVENTORY_REPORT_PATH}")


if __name__ == "__main__":
    main()
