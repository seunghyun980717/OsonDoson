"""
Build a unified gloss candidate manifest and representative clip set from:

- AIHub sign datasets
- malmoongchi parallel corpus

The pipeline has three phases:
1. Scan datasets and collect candidate segments for each gloss
2. Select one representative candidate per gloss using heuristics
3. Extract representative clips and write a generated word_db

Examples:
    python scripts/build_gloss_clips.py --scan-only
    python scripts/build_gloss_clips.py --extract-limit 100
    python scripts/build_gloss_clips.py --max-glosses 1000
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import sys

LKS_DIR = Path(__file__).resolve().parents[1]
if str(LKS_DIR) not in sys.path:
    sys.path.insert(0, str(LKS_DIR))

from core.config import (  # noqa: E402
    GENERATED_WORD_CLIPS_DIR,
    GENERATED_WORD_DB_PATH,
    GLOSS_CANDIDATE_MANIFEST_PATH,
    GLOSS_SELECTION_REPORT_PATH,
    MALMOONGCHI_DIR,
    TRAIN,
    VAL,
)


def normalize_gloss_token(token: str) -> str:
    token = token.replace("\u3000", " ").replace("_", " ").replace("／", "/").replace("·", "")
    return " ".join(token.strip().split())


def safe_clip_name(gloss: str) -> str:
    digest = hashlib.sha1(gloss.encode("utf-8")).hexdigest()[:10]
    clean = "".join(ch if ch.isalnum() or ch in "-_가-힣" else "_" for ch in gloss).strip("_")
    clean = clean[:60] if clean else "gloss"
    return f"{clean}__{digest}.mp4"


def infer_dataset_priority(dataset_kind: str) -> int:
    priorities = {
        "aihub_real_word": 600,
        "aihub_real_sen": 500,
        "aihub_crowd": 450,
        "aihub_syn_word": 350,
        "aihub_syn_sen": 300,
        "malmoongchi": 200,
    }
    return priorities.get(dataset_kind, 100)


def infer_view_priority(view: str | None) -> int:
    priorities = {"F": 50, "D": 40, "U": 30, "L": 20, "R": 20}
    return priorities.get((view or "").upper(), 10)


def duration_score(duration: float) -> float:
    if duration <= 0:
        return -100.0
    target = 1.6
    penalty = abs(duration - target) * 20.0
    if duration < 0.4:
        penalty += 50.0
    if duration > 4.0:
        penalty += 25.0
    return 100.0 - penalty


def segment_score(candidate: dict[str, Any]) -> float:
    return (
        infer_dataset_priority(str(candidate["dataset_kind"]))
        + infer_view_priority(candidate.get("view"))
        + duration_score(float(candidate["duration"]))
    )


def video_member_index(video_zip_path: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    with zipfile.ZipFile(video_zip_path) as archive:
        for member in archive.namelist():
            if member.endswith(".mp4"):
                index[Path(member).name] = member
    return index


def derive_aihub_video_zip(label_zip_path: Path) -> Path | None:
    candidate = Path(str(label_zip_path).replace("[라벨]", "[원천]").replace("morpheme", "video"))
    if candidate.exists():
        return candidate
    return None


def classify_aihub_dataset(label_zip_name: str) -> str:
    name = label_zip_name.lower()
    if "real_word" in name:
        return "aihub_real_word"
    if "real_sen" in name:
        return "aihub_real_sen"
    if "crowd" in name:
        return "aihub_crowd"
    if "syn_word" in name:
        return "aihub_syn_word"
    if "syn_sen" in name:
        return "aihub_syn_sen"
    return "aihub_other"


def iter_aihub_candidates(max_json_per_zip: int | None = None) -> Iterable[dict[str, Any]]:
    for root in (TRAIN, VAL):
        for label_zip_path in sorted(root.glob("[[]라벨]*morpheme.zip")):
            video_zip_path = derive_aihub_video_zip(label_zip_path)
            if video_zip_path is None or not video_zip_path.exists():
                continue

            dataset_kind = classify_aihub_dataset(label_zip_path.name)
            member_index = video_member_index(video_zip_path)

            with zipfile.ZipFile(label_zip_path) as label_zip:
                json_members = [name for name in label_zip.namelist() if name.endswith(".json")]
                if max_json_per_zip is not None:
                    json_members = json_members[:max_json_per_zip]

                for member in json_members:
                    payload = json.loads(label_zip.read(member).decode("utf-8-sig"))
                    meta = payload.get("metaData") or {}
                    video_name = str(meta.get("name") or "")
                    video_member = member_index.get(video_name)
                    if not video_member:
                        continue

                    view = Path(video_name).stem.split("_")[-1] if video_name else None
                    for segment in payload.get("data", []):
                        attrs = segment.get("attributes") or []
                        if not attrs:
                            continue
                        start = float(segment.get("start", 0.0) or 0.0)
                        end = float(segment.get("end", 0.0) or 0.0)
                        duration = max(0.0, end - start)
                        for attr in attrs:
                            gloss = normalize_gloss_token(str(attr.get("name") or ""))
                            if not gloss:
                                continue
                            yield {
                                "gloss": gloss,
                                "dataset_kind": dataset_kind,
                                "source_dataset": "aihub",
                                "label_zip_path": str(label_zip_path),
                                "label_member": member,
                                "video_zip_path": str(video_zip_path),
                                "video_member": video_member,
                                "video_name": video_name,
                                "view": view,
                                "start": start,
                                "end": end,
                                "duration": duration,
                            }


def iter_malmoongchi_candidates(max_json_per_zip: int | None = None) -> Iterable[dict[str, Any]]:
    for corpus_zip_path in sorted(MALMOONGCHI_DIR.glob("*.zip")):
        with zipfile.ZipFile(corpus_zip_path) as corpus_zip:
            json_members = [name for name in corpus_zip.namelist() if name.endswith(".json")]
            if max_json_per_zip is not None:
                json_members = json_members[:max_json_per_zip]

            for member in json_members:
                payload = json.loads(corpus_zip.read(member).decode("utf-8-sig"))
                video_stem = str(payload.get("vido_file_nm") or "")
                if not video_stem:
                    continue
                video_member = next((name for name in corpus_zip.namelist() if name.endswith(f"{video_stem}.mp4")), None)
                if not video_member:
                    continue

                gestures = (payload.get("sign_script") or {}).get("sign_gestures_strong") or []
                for gesture in gestures:
                    gloss = normalize_gloss_token(str(gesture.get("gloss_id") or ""))
                    if not gloss:
                        continue
                    start = float(gesture.get("start", 0.0) or 0.0)
                    end = float(gesture.get("end", 0.0) or 0.0)
                    duration = max(0.0, end - start)
                    yield {
                        "gloss": gloss,
                        "dataset_kind": "malmoongchi",
                        "source_dataset": "malmoongchi",
                        "label_zip_path": str(corpus_zip_path),
                        "label_member": member,
                        "video_zip_path": str(corpus_zip_path),
                        "video_member": video_member,
                        "video_name": Path(video_member).name,
                        "view": None,
                        "start": start,
                        "end": end,
                        "duration": duration,
                    }


def build_manifest(
    max_aihub_json_per_zip: int | None = None,
    max_mal_json_per_zip: int | None = None,
) -> dict[str, Any]:
    by_gloss: dict[str, list[dict[str, Any]]] = defaultdict(list)
    source_counts = Counter()
    candidate_count = 0

    for candidate in iter_aihub_candidates(max_json_per_zip=max_aihub_json_per_zip):
        candidate_count += 1
        source_counts[candidate["dataset_kind"]] += 1
        by_gloss[str(candidate["gloss"])].append(candidate)

    for candidate in iter_malmoongchi_candidates(max_json_per_zip=max_mal_json_per_zip):
        candidate_count += 1
        source_counts[candidate["dataset_kind"]] += 1
        by_gloss[str(candidate["gloss"])].append(candidate)

    selected: dict[str, dict[str, Any]] = {}
    candidate_sizes: dict[str, int] = {}
    for gloss, candidates in by_gloss.items():
        for candidate in candidates:
            candidate["score"] = round(segment_score(candidate), 2)
        candidates.sort(
            key=lambda item: (
                -float(item["score"]),
                -float(item["duration"]),
                str(item["video_name"]),
            )
        )
        selected[gloss] = candidates[0]
        candidate_sizes[gloss] = len(candidates)

    report = {
        "summary": {
            "candidate_count": candidate_count,
            "unique_glosses": len(by_gloss),
            "source_counts": dict(source_counts),
        },
        "top_candidate_pool_sizes": [
            {"gloss": gloss, "candidate_count": count}
            for gloss, count in sorted(candidate_sizes.items(), key=lambda item: (-item[1], item[0]))[:100]
        ],
    }
    manifest = {
        "report": report,
        "selected": dict(sorted(selected.items(), key=lambda item: item[0])),
    }
    return manifest


def save_manifest(manifest: dict[str, Any]) -> None:
    GLOSS_CANDIDATE_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GLOSS_CANDIDATE_MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)


def load_manifest() -> dict[str, Any]:
    with open(GLOSS_CANDIDATE_MANIFEST_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def ffmpeg_extract_clip(source_video: Path, start: float, end: float, output_path: Path) -> None:
    duration = max(0.05, end - start)
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source_video),
        "-t",
        f"{duration:.3f}",
        "-an",
        "-vf",
        "scale=1280:-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore") if result.stderr else ""
        raise RuntimeError(stderr[-2000:])


def extract_selected_clips(
    selected: dict[str, dict[str, Any]],
    output_dir: Path = GENERATED_WORD_CLIPS_DIR,
    output_db_path: Path = GENERATED_WORD_DB_PATH,
    extract_limit: int | None = None,
    max_glosses: int | None = None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix="gloss_build_"))
    generated_db: dict[str, str] = {}
    report = {
        "attempted": 0,
        "extracted": 0,
        "skipped_existing": 0,
        "failed": [],
    }

    items = list(selected.items())
    if max_glosses is not None:
        items = items[:max_glosses]

    grouped: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for gloss, candidate in items:
        grouped[(candidate["video_zip_path"], candidate["video_member"])].append((gloss, candidate))

    extracted_glosses = 0
    try:
        for (video_zip_path_str, video_member), group in grouped.items():
            if extract_limit is not None and extracted_glosses >= extract_limit:
                break

            source_zip_path = Path(video_zip_path_str)
            source_video_path = temp_dir / Path(video_member).name

            with zipfile.ZipFile(source_zip_path) as archive:
                with archive.open(video_member) as source_handle, open(source_video_path, "wb") as target_handle:
                    shutil.copyfileobj(source_handle, target_handle)

            for gloss, candidate in group:
                if extract_limit is not None and extracted_glosses >= extract_limit:
                    break

                output_name = safe_clip_name(gloss)
                output_path = output_dir / output_name
                report["attempted"] += 1

                if output_path.exists():
                    generated_db[gloss] = str(output_path)
                    report["skipped_existing"] += 1
                    extracted_glosses += 1
                    continue

                try:
                    ffmpeg_extract_clip(
                        source_video=source_video_path,
                        start=float(candidate["start"]),
                        end=float(candidate["end"]),
                        output_path=output_path,
                    )
                    generated_db[gloss] = str(output_path)
                    report["extracted"] += 1
                    extracted_glosses += 1
                except Exception as exc:  # noqa: BLE001
                    report["failed"].append({"gloss": gloss, "error": str(exc)[:1000]})

            source_video_path.unlink(missing_ok=True)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    with open(output_db_path, "w", encoding="utf-8") as handle:
        json.dump(generated_db, handle, ensure_ascii=False, indent=2)

    selection_report = {
        "summary": report,
        "output_dir": str(output_dir),
        "output_db_path": str(output_db_path),
    }
    with open(GLOSS_SELECTION_REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(selection_report, handle, ensure_ascii=False, indent=2)

    return selection_report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scan-only", action="store_true")
    parser.add_argument("--reuse-manifest", action="store_true")
    parser.add_argument("--extract-limit", type=int, default=None)
    parser.add_argument("--max-glosses", type=int, default=None)
    parser.add_argument("--max-aihub-json-per-zip", type=int, default=None)
    parser.add_argument("--max-mal-json-per-zip", type=int, default=None)
    args = parser.parse_args()

    if args.reuse_manifest and GLOSS_CANDIDATE_MANIFEST_PATH.exists():
        manifest = load_manifest()
        summary = manifest["report"]["summary"]
        print(
            "[gloss_clips] reusing manifest: candidates={candidate_count} unique_glosses={unique_glosses}".format(
                **summary
            )
        )
    else:
        manifest = build_manifest(
            max_aihub_json_per_zip=args.max_aihub_json_per_zip,
            max_mal_json_per_zip=args.max_mal_json_per_zip,
        )
        save_manifest(manifest)
        summary = manifest["report"]["summary"]
        print(
            "[gloss_clips] candidates={candidate_count} unique_glosses={unique_glosses}".format(
                **summary
            )
        )
        print(f"[gloss_clips] manifest saved: {GLOSS_CANDIDATE_MANIFEST_PATH}")

    if args.scan_only:
        return

    selection_report = extract_selected_clips(
        manifest["selected"],
        extract_limit=args.extract_limit,
        max_glosses=args.max_glosses,
    )
    print(
        "[gloss_clips] extracted={extracted} skipped_existing={skipped_existing} failed={failed}".format(
            extracted=selection_report["summary"]["extracted"],
            skipped_existing=selection_report["summary"]["skipped_existing"],
            failed=len(selection_report["summary"]["failed"]),
        )
    )
    print(f"[gloss_clips] word_db saved: {GENERATED_WORD_DB_PATH}")
    print(f"[gloss_clips] report saved: {GLOSS_SELECTION_REPORT_PATH}")


if __name__ == "__main__":
    main()
