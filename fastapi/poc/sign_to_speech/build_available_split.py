"""
Build sentence-grouped train/val CSVs from the AIHub keypoint zips available on disk.

Why:
  The official CSV split can overlap heavily at the sentence level across
  train/val, and it can also reference files not currently downloaded.
  This script:
    1. scans the actually available keypoint zips
    2. keeps only samples with official labels
    3. re-splits them by SENxxxx group so train/val sentence IDs do not overlap

Outputs:
  - LKS/data/derived/splits/available_train.csv
  - LKS/data/derived/splits/available_val.csv
  - LKS/data/derived/splits/available_split_report.json

Usage:
    python -m sign_to_speech.build_available_split
    python -m sign_to_speech.build_available_split --val_ratio 0.1 --seed 42
"""
import argparse
import csv
import json
import random
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    AVAILABLE_TRAIN_CSV,
    AVAILABLE_VAL_CSV,
    OFFICIAL_TRAIN_CSV,
    OFFICIAL_VAL_CSV,
    SPLITS_DIR,
    TRAIN,
    VAL,
)

SEN_PATTERN = re.compile(r"SEN(\d+)")
REAL_PATTERN = re.compile(r"REAL(\d+)")


def _read_label_map() -> dict[str, str]:
    label_map: dict[str, str] = {}
    duplicate_conflicts: list[dict[str, str]] = []

    for csv_path in (OFFICIAL_TRAIN_CSV, OFFICIAL_VAL_CSV):
        with open(csv_path, encoding="euc-kr") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) < 3:
                    continue
                filename = row[1].strip()
                gloss = row[2].strip()
                if not filename or not gloss:
                    continue

                prev = label_map.get(filename)
                if prev is not None and prev != gloss:
                    duplicate_conflicts.append(
                        {"filename": filename, "existing": prev, "incoming": gloss}
                    )
                label_map[filename] = gloss

    if duplicate_conflicts:
        print(f"[build_available_split] warning: conflicting labels={len(duplicate_conflicts)}")
    return label_map


def _sen_id(video_name: str) -> str | None:
    match = SEN_PATTERN.search(video_name)
    return match.group(1) if match else None


def _real_id(video_name: str) -> str:
    match = REAL_PATTERN.search(video_name)
    return match.group(1) if match else "UNKNOWN"


def _collect_available_samples(zip_paths: list[Path], label_map: dict[str, str]) -> tuple[list[dict], dict[str, int]]:
    samples: list[dict] = []
    by_zip: dict[str, int] = {}

    for zip_path in zip_paths:
        print(f"[build_available_split] scanning {zip_path.name}")
        names: set[str] = set()
        with zipfile.ZipFile(zip_path) as zf:
            for entry in zf.namelist():
                if entry.endswith("_keypoints.json"):
                    names.add(Path(entry).parent.name)

        kept = 0
        for video_name in sorted(names):
            filename = f"{video_name}.mp4"
            gloss = label_map.get(filename)
            sen_id = _sen_id(video_name)
            if gloss is None or sen_id is None:
                continue

            samples.append(
                {
                    "filename": filename,
                    "gloss": gloss,
                    "video_name": video_name,
                    "sen_id": sen_id,
                    "real_id": _real_id(video_name),
                    "zip_name": zip_path.name,
                }
            )
            kept += 1

        by_zip[zip_path.name] = kept
        print(f"  kept={kept}")

    return samples, by_zip


def _group_split(samples: list[dict], val_ratio: float, seed: int) -> tuple[list[dict], list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for sample in samples:
        groups[sample["sen_id"]].append(sample)

    sen_ids = sorted(groups)
    rng = random.Random(seed)
    rng.shuffle(sen_ids)

    n_val_groups = max(1, int(len(sen_ids) * val_ratio))
    val_sen_ids = set(sen_ids[:n_val_groups])

    train_samples: list[dict] = []
    val_samples: list[dict] = []
    for sen_id, group_samples in groups.items():
        if sen_id in val_sen_ids:
            val_samples.extend(group_samples)
        else:
            train_samples.extend(group_samples)

    train_samples.sort(key=lambda x: x["filename"])
    val_samples.sort(key=lambda x: x["filename"])
    return train_samples, val_samples


def _to_rows(samples: list[dict]) -> list[list[str]]:
    rows: list[list[str]] = []
    for idx, sample in enumerate(samples, 1):
        rows.append([str(idx), sample["filename"], sample["gloss"]])
    return rows


def _write_csv(csv_path: Path, rows: list[list[str]]):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", encoding="euc-kr", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Num", "Filename", "Kor"])
        writer.writerows(rows)
    print(f"[build_available_split] saved: {csv_path} ({len(rows)} rows)")


def _count_by_key(samples: list[dict], key: str) -> dict[str, int]:
    counter = Counter(sample[key] for sample in samples)
    return dict(sorted(counter.items()))


def build_available_split(val_ratio: float = 0.1, seed: int = 42):
    zip_paths = sorted(TRAIN.glob("*real_sen_keypoint*.zip")) + sorted(VAL.glob("*real_sen_keypoint*.zip"))
    if not zip_paths:
        raise FileNotFoundError(f"no real_sen keypoint zip found under {TRAIN} and {VAL}")

    label_map = _read_label_map()
    available_samples, by_zip = _collect_available_samples(zip_paths, label_map)
    if not available_samples:
        raise RuntimeError("no labeled samples found in the available keypoint zips")

    train_samples, val_samples = _group_split(available_samples, val_ratio=val_ratio, seed=seed)
    _write_csv(AVAILABLE_TRAIN_CSV, _to_rows(train_samples))
    _write_csv(AVAILABLE_VAL_CSV, _to_rows(val_samples))

    train_sen_ids = {sample["sen_id"] for sample in train_samples}
    val_sen_ids = {sample["sen_id"] for sample in val_samples}

    report = {
        "summary": {
            "available_samples": len(available_samples),
            "train_samples": len(train_samples),
            "val_samples": len(val_samples),
            "train_sentence_groups": len(train_sen_ids),
            "val_sentence_groups": len(val_sen_ids),
            "sentence_group_overlap": len(train_sen_ids & val_sen_ids),
            "val_ratio": val_ratio,
            "seed": seed,
        },
        "train": {
            "real_ids": _count_by_key(train_samples, "real_id"),
            "zip_counts": _count_by_key(train_samples, "zip_name"),
        },
        "val": {
            "real_ids": _count_by_key(val_samples, "real_id"),
            "zip_counts": _count_by_key(val_samples, "zip_name"),
        },
        "available_zip_counts": by_zip,
    }

    report_path = SPLITS_DIR / "available_split_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"[build_available_split] saved: {report_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--val_ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    build_available_split(val_ratio=args.val_ratio, seed=args.seed)
