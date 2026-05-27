"""
Build token segment manifests from sentence morpheme zips for the current split CSVs.

Outputs:
  - LKS/data/derived/segment_manifests/train_segments.json
  - LKS/data/derived/segment_manifests/val_segments.json
"""
import csv
import json
import zipfile
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    SEGMENT_MANIFEST_DIR,
    TRAIN_CSV,
    TRAIN_SEN_MORPHEME_ZIP,
    VAL_CSV,
    VAL_SEN_09_MORPHEME_ZIP,
)
from data_utils.morpheme_parser import parse_morpheme


def _read_sample_names(csv_path: Path) -> list[str]:
    names = []
    with open(csv_path, encoding="euc-kr") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) >= 2:
                names.append(row[1].replace(".mp4", ""))
    return names


def _build_zip_lookup(zip_path: Path) -> dict[str, str]:
    lookup: dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith("_morpheme.json"):
                stem = Path(name).name.replace("_morpheme.json", "")
                lookup[stem] = name
    return lookup


def _collect_segments(sample_names: list[str], zip_paths: list[Path]) -> dict[str, list[dict]]:
    zip_handles = []
    for zip_path in zip_paths:
        if zip_path.exists():
            print(f"[build_segment_manifest] indexing {zip_path.name}")
            lookup = _build_zip_lookup(zip_path)
            zip_handles.append((zipfile.ZipFile(zip_path), lookup))

    manifest: dict[str, list[dict]] = {}
    missing = 0

    try:
        for idx, sample_name in enumerate(sample_names, 1):
            found = False
            for zf, lookup in zip_handles:
                entry = lookup.get(sample_name)
                if entry is None:
                    continue
                data = json.loads(zf.read(entry))
                segments = parse_morpheme(data)
                manifest[sample_name] = [
                    {
                        "gloss": seg.gloss,
                        "start_frame": seg.start_frame,
                        "end_frame": seg.end_frame,
                    }
                    for seg in segments
                    if seg.end_frame > seg.start_frame
                ]
                found = True
                break

            if not found:
                missing += 1
            if idx % 2000 == 0:
                print(f"  {idx}/{len(sample_names)} processed")
    finally:
        for zf, _ in zip_handles:
            zf.close()

    print(f"[build_segment_manifest] collected={len(manifest)} missing={missing}")
    return manifest


def build_segment_manifest():
    SEGMENT_MANIFEST_DIR.mkdir(parents=True, exist_ok=True)

    train_names = _read_sample_names(TRAIN_CSV)
    val_names = _read_sample_names(VAL_CSV)
    zip_paths = [TRAIN_SEN_MORPHEME_ZIP, VAL_SEN_09_MORPHEME_ZIP]

    train_manifest = _collect_segments(train_names, zip_paths)
    val_manifest = _collect_segments(val_names, zip_paths)

    train_path = SEGMENT_MANIFEST_DIR / "train_segments.json"
    val_path = SEGMENT_MANIFEST_DIR / "val_segments.json"
    train_path.write_text(json.dumps(train_manifest, ensure_ascii=False), encoding="utf-8")
    val_path.write_text(json.dumps(val_manifest, ensure_ascii=False), encoding="utf-8")
    print(f"[build_segment_manifest] saved: {train_path}")
    print(f"[build_segment_manifest] saved: {val_path}")


if __name__ == "__main__":
    build_segment_manifest()
