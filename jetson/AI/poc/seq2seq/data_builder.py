"""
Build a leakage-resistant seq2seq dataset for gloss <-> Korean translation.

Key rule:
- Split records by connected components over normalized Korean and normalized
  gloss sentences, not by individual task examples.
- This keeps duplicate or near-duplicate pairs in the same split and prevents
  g2k/k2g task pairs from leaking across train/val/test.

Examples:
    python -m poc.seq2seq.data_builder --stats
    python -m poc.seq2seq.data_builder --seed 42
    python -m poc.seq2seq.data_builder --limit-malmoongchi-files 10
"""

from __future__ import annotations

import argparse
import json
import random
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import pandas as pd

from core.config import (
    GKSL_DIR,
    MALMOONGCHI_DIR,
    SEQ2SEQ_DATA_PATH,
    SEQ2SEQ_REPORT_PATH,
    get_active_word_db_path,
)

GLOSS_COL = "Gloss level Korean Sign Language (GKSL) sentence"
KOREAN_COL = "Word level Korean Language (WKL) sentence"

GLOSS_TO_KO_PREFIX = "글로스를 한국어로 번역: "
KO_TO_GLOSS_PREFIX = "한국어를 글로스로 변환: "

DEFAULT_TRAIN_RATIO = 0.8
DEFAULT_VAL_RATIO = 0.1
DEFAULT_TEST_RATIO = 0.1

_SPACE_RE = re.compile(r"\s+")


@dataclass
class RawRecord:
    record_id: str
    source: str
    korean: str
    gloss: str
    meta: Dict[str, object]


class UnionFind:
    def __init__(self) -> None:
        self.parent: Dict[str, str] = {}
        self.rank: Dict[str, int] = {}

    def add(self, value: str) -> None:
        if value not in self.parent:
            self.parent[value] = value
            self.rank[value] = 0

    def find(self, value: str) -> str:
        self.add(value)
        if self.parent[value] != value:
            self.parent[value] = self.find(self.parent[value])
        return self.parent[value]

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        left_rank = self.rank[left_root]
        right_rank = self.rank[right_root]
        if left_rank < right_rank:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if left_rank == right_rank:
            self.rank[left_root] += 1


def _normalize_space(text: str) -> str:
    return _SPACE_RE.sub(" ", text.strip())


def normalize_korean(text: str) -> str:
    text = (text or "").replace("\u3000", " ")
    return _normalize_space(text)


def normalize_gloss_token(token: str) -> str:
    token = (token or "").strip()
    token = token.replace("_", " ")
    token = token.replace("·", "")
    token = token.replace("／", "/")
    token = token.replace("|", "")
    return _normalize_space(token)


def normalize_gloss_tokens(tokens: Iterable[str]) -> List[str]:
    normalized: List[str] = []
    for token in tokens:
        clean = normalize_gloss_token(token)
        if clean:
            normalized.append(clean)
    return normalized


def normalize_gloss_string(text: str) -> str:
    separators = ["/", ",", ";", "\n", "\t"]
    for sep in separators:
        text = text.replace(sep, " ")
    return " ".join(normalize_gloss_tokens(text.split()))


def load_word_db_vocab(word_db_path: Path | None = None) -> set[str]:
    word_db_path = word_db_path or get_active_word_db_path()
    if not word_db_path.exists():
        return set()
    with open(word_db_path, encoding="utf-8") as handle:
        return set(json.load(handle).keys())


def project_gloss_to_runtime(tokens: Sequence[str], word_db_vocab: set[str]) -> list[str]:
    if not word_db_vocab:
        return list(tokens)
    return [token for token in tokens if token in word_db_vocab]


def _read_json_from_zip(zf: zipfile.ZipFile, member: str) -> Dict[str, object]:
    return json.loads(zf.read(member).decode("utf-8-sig"))


def _extract_malmoongchi_gloss(payload: Dict[str, object]) -> List[str]:
    sign_script = payload.get("sign_script") or {}
    gestures = sign_script.get("sign_gestures_strong") or []
    timed = []
    for gesture in gestures:
        gloss_id = normalize_gloss_token(str(gesture.get("gloss_id", "")))
        if not gloss_id:
            continue
        start = float(gesture.get("start", 0.0) or 0.0)
        timed.append((start, gloss_id))
    if timed:
        return [token for _, token in sorted(timed, key=lambda item: item[0])]
    raw = str(payload.get("sign_lang_sntenc", "") or "")
    return normalize_gloss_tokens(raw.replace("/", " ").split())


def load_gksl_records(gksl_dir: Path = GKSL_DIR) -> List[RawRecord]:
    dataset_dir = gksl_dir / "dataset"
    files = [
        ("gksl_original", dataset_dir / "GKSL3k_original.csv"),
        ("gksl_augmented", dataset_dir / "GKSL13k_augmented.csv"),
    ]
    records: List[RawRecord] = []
    for source, csv_path in files:
        if not csv_path.exists():
            if source == "gksl_augmented":
                continue
            raise FileNotFoundError(f"GKSL dataset not found: {csv_path}")
        frame = pd.read_csv(csv_path, encoding="utf-8").dropna(subset=[GLOSS_COL, KOREAN_COL])
        for index, row in frame.iterrows():
            korean = normalize_korean(str(row[KOREAN_COL]))
            gloss = normalize_gloss_string(str(row[GLOSS_COL]))
            if not korean or not gloss:
                continue
            records.append(
                RawRecord(
                    record_id=f"{source}:{index}",
                    source=source,
                    korean=korean,
                    gloss=gloss,
                    meta={"source_file": str(csv_path.name)},
                )
            )
    return records


def load_malmoongchi_records(
    malmoongchi_dir: Path = MALMOONGCHI_DIR,
    limit_files: int | None = None,
) -> List[RawRecord]:
    if not malmoongchi_dir.exists():
        return []

    zip_paths = sorted(malmoongchi_dir.glob("*.zip"))
    records: List[RawRecord] = []
    seen = 0
    for zip_path in zip_paths:
        with zipfile.ZipFile(zip_path) as zf:
            members = sorted(name for name in zf.namelist() if name.endswith(".json"))
            for member in members:
                if limit_files is not None and seen >= limit_files:
                    return records
                payload = _read_json_from_zip(zf, member)
                korean_block = payload.get("krlgg_sntenc") or {}
                korean = normalize_korean(str(korean_block.get("koreanText", "")))
                gloss_tokens = _extract_malmoongchi_gloss(payload)
                gloss = " ".join(gloss_tokens)
                if not korean or not gloss:
                    continue
                sample_id = str(payload.get("id") or f"{zip_path.stem}:{member}")
                records.append(
                    RawRecord(
                        record_id=f"malmoongchi:{sample_id}",
                        source="malmoongchi",
                        korean=korean,
                        gloss=gloss,
                        meta={
                            "source_file": zip_path.name,
                            "member": member,
                            "realm": korean_block.get("realm"),
                            "thema": korean_block.get("thema"),
                            "category": korean_block.get("category"),
                        },
                    )
                )
                seen += 1
    return records


def collect_raw_records(
    include_gksl: bool = True,
    include_malmoongchi: bool = True,
    limit_malmoongchi_files: int | None = None,
) -> List[RawRecord]:
    records: List[RawRecord] = []
    if include_gksl:
        records.extend(load_gksl_records())
    if include_malmoongchi:
        records.extend(load_malmoongchi_records(limit_files=limit_malmoongchi_files))
    return records


def deduplicate_records(
    raw_records: Sequence[RawRecord],
    filter_to_word_db: bool = False,
    word_db_vocab: set[str] | None = None,
) -> List[Dict[str, object]]:
    word_db_vocab = word_db_vocab or set()
    merged: Dict[str, Dict[str, object]] = {}

    for raw in raw_records:
        raw_tokens = raw.gloss.split()
        full_gloss = " ".join(raw_tokens).strip()
        runtime_tokens = project_gloss_to_runtime(raw_tokens, word_db_vocab)
        runtime_gloss = " ".join(runtime_tokens).strip()
        if not full_gloss:
            continue
        if filter_to_word_db and not runtime_gloss:
            continue

        pair_key = f"{raw.korean}|||{full_gloss}"
        current = merged.get(pair_key)
        if current is None:
            merged[pair_key] = {
                "record_id": raw.record_id,
                "pair_key": pair_key,
                "korean": raw.korean,
                "gloss": full_gloss,
                "raw_gloss": raw.gloss,
                "runtime_gloss": runtime_gloss,
                "runtime_gloss_tokens": runtime_tokens,
                "sources": [raw.source],
                "meta": [raw.meta],
            }
            continue

        source_list = current["sources"]
        if raw.source not in source_list:
            source_list.append(raw.source)
        current["meta"].append(raw.meta)
        if len(raw.gloss.split()) > len(str(current["raw_gloss"]).split()):
            current["raw_gloss"] = raw.gloss
            current["runtime_gloss"] = runtime_gloss
            current["runtime_gloss_tokens"] = runtime_tokens

    return list(merged.values())


def assign_components(records: Sequence[Dict[str, object]]) -> Dict[str, List[Dict[str, object]]]:
    uf = UnionFind()
    for record in records:
        korean_node = f"K:{record['korean']}"
        gloss_node = f"G:{record['gloss']}"
        uf.union(korean_node, gloss_node)

    components: Dict[str, List[Dict[str, object]]] = defaultdict(list)
    for record in records:
        component_id = uf.find(f"K:{record['korean']}")
        item = dict(record)
        item["component_id"] = component_id
        components[component_id].append(item)
    return components


def split_components(
    components: Dict[str, List[Dict[str, object]]],
    train_ratio: float = DEFAULT_TRAIN_RATIO,
    val_ratio: float = DEFAULT_VAL_RATIO,
    test_ratio: float = DEFAULT_TEST_RATIO,
    seed: int = 42,
) -> Dict[str, List[Dict[str, object]]]:
    if abs((train_ratio + val_ratio + test_ratio) - 1.0) > 1e-6:
        raise ValueError("train/val/test ratios must sum to 1.0")

    component_items = list(components.items())
    random.Random(seed).shuffle(component_items)

    total_records = sum(len(items) for _, items in component_items)
    targets = {
        "train": total_records * train_ratio,
        "val": total_records * val_ratio,
        "test": total_records * test_ratio,
    }
    split_records: Dict[str, List[Dict[str, object]]] = {"train": [], "val": [], "test": []}
    counts = Counter()

    for _, items in component_items:
        remaining = {name: targets[name] - counts[name] for name in ("train", "val", "test")}
        if all(value <= 0 for value in remaining.values()):
            chosen = "train"
        else:
            chosen = max(remaining, key=remaining.get)
        split_records[chosen].extend(items)
        counts[chosen] += len(items)

    return split_records


def build_task_examples(records_by_split: Dict[str, List[Dict[str, object]]]) -> Dict[str, List[Dict[str, object]]]:
    examples: Dict[str, List[Dict[str, object]]] = {}
    for split_name, records in records_by_split.items():
        split_examples: List[Dict[str, object]] = []
        for record in records:
            split_examples.append(
                {
                    "task": "g2k",
                    "record_id": record["record_id"],
                    "component_id": record["component_id"],
                    "input": GLOSS_TO_KO_PREFIX + str(record["gloss"]),
                    "target": record["korean"],
                    "gloss_full": record["gloss"],
                    "gloss_runtime": record.get("runtime_gloss", ""),
                    "source": sorted(record["sources"]),
                }
            )
            split_examples.append(
                {
                    "task": "k2g",
                    "record_id": record["record_id"],
                    "component_id": record["component_id"],
                    "input": KO_TO_GLOSS_PREFIX + str(record["korean"]),
                    "target": record["gloss"],
                    "gloss_full": record["gloss"],
                    "gloss_runtime": record.get("runtime_gloss", ""),
                    "source": sorted(record["sources"]),
                }
            )
        examples[split_name] = split_examples
    return examples


def build_audit_report(records_by_split: Dict[str, List[Dict[str, object]]]) -> Dict[str, object]:
    normalized_korean = {name: {str(record["korean"]) for record in records} for name, records in records_by_split.items()}
    normalized_gloss = {name: {str(record["gloss"]) for record in records} for name, records in records_by_split.items()}
    pair_keys = {name: {str(record["pair_key"]) for record in records} for name, records in records_by_split.items()}
    components = {name: {str(record["component_id"]) for record in records} for name, records in records_by_split.items()}

    def overlaps(mapping: Dict[str, set[str]]) -> Dict[str, int]:
        keys = list(mapping.keys())
        result: Dict[str, int] = {}
        for i, left in enumerate(keys):
            for right in keys[i + 1 :]:
                result[f"{left}__{right}"] = len(mapping[left] & mapping[right])
        return result

    split_counts = {}
    for split_name, records in records_by_split.items():
        sources = Counter()
        for record in records:
            sources.update(record["sources"])
        split_counts[split_name] = {
            "records": len(records),
            "components": len(components[split_name]),
            "sources": dict(sorted(sources.items())),
        }

    leakage = {
        "component_overlap": overlaps(components),
        "korean_overlap": overlaps(normalized_korean),
        "gloss_overlap": overlaps(normalized_gloss),
        "pair_overlap": overlaps(pair_keys),
    }

    return {
        "split_counts": split_counts,
        "leakage": leakage,
        "clean": all(all(value == 0 for value in group.values()) for group in leakage.values()),
    }


def print_stats(records: Sequence[Dict[str, object]], audit: Dict[str, object]) -> None:
    source_counter = Counter()
    gloss_lengths: List[int] = []
    runtime_lengths: List[int] = []
    runtime_covered = 0
    for record in records:
        source_counter.update(record["sources"])
        gloss_lengths.append(len(str(record["gloss"]).split()))
        runtime_gloss = str(record.get("runtime_gloss", "")).strip()
        runtime_lengths.append(len(runtime_gloss.split()) if runtime_gloss else 0)
        if runtime_gloss:
            runtime_covered += 1

    print("[data_builder] records:", len(records))
    print("[data_builder] sources:", dict(sorted(source_counter.items())))
    if gloss_lengths:
        print(
            "[data_builder] gloss tokens: mean={:.2f} max={}".format(
                sum(gloss_lengths) / len(gloss_lengths),
                max(gloss_lengths),
            )
        )
        print(
            "[data_builder] runtime tokens: mean={:.2f} covered={}/{}".format(
                sum(runtime_lengths) / len(runtime_lengths),
                runtime_covered,
                len(runtime_lengths),
            )
        )
    print("[data_builder] leakage clean:", audit["clean"])
    print("[data_builder] split counts:", audit["split_counts"])


def build_dataset(
    include_gksl: bool = True,
    include_malmoongchi: bool = True,
    limit_malmoongchi_files: int | None = None,
    filter_to_word_db: bool = False,
    train_ratio: float = DEFAULT_TRAIN_RATIO,
    val_ratio: float = DEFAULT_VAL_RATIO,
    test_ratio: float = DEFAULT_TEST_RATIO,
    seed: int = 42,
) -> Dict[str, object]:
    raw_records = collect_raw_records(
        include_gksl=include_gksl,
        include_malmoongchi=include_malmoongchi,
        limit_malmoongchi_files=limit_malmoongchi_files,
    )
    word_db_vocab = load_word_db_vocab()
    records = deduplicate_records(
        raw_records,
        filter_to_word_db=filter_to_word_db,
        word_db_vocab=word_db_vocab,
    )
    components = assign_components(records)
    split_records = split_components(
        components,
        train_ratio=train_ratio,
        val_ratio=val_ratio,
        test_ratio=test_ratio,
        seed=seed,
    )
    split_examples = build_task_examples(split_records)
    audit = build_audit_report(split_records)

    report = {
        "meta": {
            "include_gksl": include_gksl,
            "include_malmoongchi": include_malmoongchi,
            "filter_to_word_db": filter_to_word_db,
            "task_gloss_mode": "full_gloss",
            "limit_malmoongchi_files": limit_malmoongchi_files,
            "seed": seed,
            "ratios": {"train": train_ratio, "val": val_ratio, "test": test_ratio},
            "active_word_db_path": str(get_active_word_db_path()),
            "active_word_db_vocab_size": len(word_db_vocab),
        },
        "audit": audit,
    }

    dataset = {
        "meta": report["meta"],
        "records": split_records,
        "train": split_examples["train"],
        "val": split_examples["val"],
        "test": split_examples["test"],
    }

    SEQ2SEQ_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SEQ2SEQ_DATA_PATH, "w", encoding="utf-8") as handle:
        json.dump(dataset, handle, ensure_ascii=False, indent=2)
    with open(SEQ2SEQ_REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    flat_records = [record for records in split_records.values() for record in records]
    print_stats(flat_records, audit)
    print(f"[data_builder] dataset saved: {SEQ2SEQ_DATA_PATH}")
    print(f"[data_builder] report saved: {SEQ2SEQ_REPORT_PATH}")
    return dataset


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--train-ratio", type=float, default=DEFAULT_TRAIN_RATIO)
    parser.add_argument("--val-ratio", type=float, default=DEFAULT_VAL_RATIO)
    parser.add_argument("--test-ratio", type=float, default=DEFAULT_TEST_RATIO)
    parser.add_argument("--limit-malmoongchi-files", type=int, default=None)
    parser.add_argument("--gksl-only", action="store_true")
    parser.add_argument("--malmoongchi-only", action="store_true")
    parser.add_argument("--filter-word-db", action="store_true")
    args = parser.parse_args()

    include_gksl = not args.malmoongchi_only
    include_malmoongchi = not args.gksl_only

    dataset = build_dataset(
        include_gksl=include_gksl,
        include_malmoongchi=include_malmoongchi,
        limit_malmoongchi_files=args.limit_malmoongchi_files,
        filter_to_word_db=args.filter_word_db,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        test_ratio=args.test_ratio,
        seed=args.seed,
    )

    if args.stats:
        total_examples = len(dataset["train"]) + len(dataset["val"]) + len(dataset["test"])
        print("[data_builder] task examples:", total_examples)


if __name__ == "__main__":
    main()
