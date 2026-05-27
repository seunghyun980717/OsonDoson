#!/usr/bin/env python3
"""Create structure-repaired 2D hand-keypoint QA copies and reports."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_WORD_ROOT = THREE_D_ROOT / "data" / "words"
DEFAULT_SELECTION_JSON = (
    THREE_D_ROOT
    / "hand_lifting"
    / "runs"
    / "viewer_qa_full"
    / "qa_no_source_3d_selection.json"
)
DEFAULT_OUTPUT_DIR = THREE_D_ROOT / "hand_lifting" / "runs" / "2d_hand_repair_v1"

sys.path.insert(0, str(SCRIPT_DIR))

from repair_2d_hand_keypoints import (  # noqa: E402
    HandRepairConfig,
    repair_2d_hand_keypoints,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--word-root", type=Path, default=DEFAULT_WORD_ROOT)
    parser.add_argument("--selection-json", type=Path, default=DEFAULT_SELECTION_JSON)
    parser.add_argument("--include-pattern", default="*.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--output-prefix", default="repair2d_QA_full")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--write-copy", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--markdown", action="store_true")
    parser.add_argument("--clean", action="store_true")
    parser.add_argument("--low-confidence-threshold", type=float, default=0.2)
    parser.add_argument("--stable-confidence-threshold", type=float, default=0.35)
    parser.add_argument("--bone-min-ratio", type=float, default=0.45)
    parser.add_argument("--bone-max-ratio", type=float, default=1.9)
    parser.add_argument("--local-deviation-threshold", type=float, default=0.10)
    parser.add_argument("--cross-hand-distance-threshold", type=float, default=0.08)
    parser.add_argument("--cross-hand-distal-confidence-max", type=float, default=0.65)
    parser.add_argument("--max-interpolate-run", type=int, default=3)
    parser.add_argument("--thumb-relax-scale", type=float, default=1.35)
    parser.add_argument("--top-frame-limit", type=int, default=300)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def values_for(image_2d: dict[str, Any], part: str) -> list[Any]:
    values = ((image_2d or {}).get(part) or {}).get("values")
    return values if isinstance(values, list) else []


def shape_block(values: list[Any], point_count: int) -> dict[str, Any]:
    return {"shape": [len(values), point_count, 3], "values": values}


def load_selected_words(selection_json: Path, word_root: Path, include_pattern: str, limit: int) -> list[str]:
    words: list[str] = []
    if selection_json.exists():
        payload = load_json(selection_json)
        if isinstance(payload.get("selected_words"), list):
            words = [str(word) for word in payload["selected_words"]]
        elif isinstance(payload.get("selected"), list):
            words = [
                str(item.get("word"))
                for item in payload["selected"]
                if isinstance(item, dict) and item.get("word")
            ]
    if not words:
        excluded_prefixes = (
            "mlp_",
            "post_",
            "qa_",
            "original2d_",
            "smooth2d_",
            "smooth2d_v2_",
            "repair2d_",
            "tcn_",
        )
        words = [
            path.stem
            for path in sorted(word_root.glob(include_pattern))
            if not path.name.startswith(excluded_prefixes)
        ]
    if limit > 0:
        words = words[:limit]
    return words


def config_from_args(args: argparse.Namespace) -> HandRepairConfig:
    return HandRepairConfig(
        low_confidence_threshold=args.low_confidence_threshold,
        stable_confidence_threshold=args.stable_confidence_threshold,
        bone_min_ratio=args.bone_min_ratio,
        bone_max_ratio=args.bone_max_ratio,
        local_deviation_threshold=args.local_deviation_threshold,
        cross_hand_distance_threshold=args.cross_hand_distance_threshold,
        cross_hand_distal_confidence_max=args.cross_hand_distal_confidence_max,
        max_interpolate_run=args.max_interpolate_run,
        thumb_relax_scale=args.thumb_relax_scale,
    )


def process_word(task: tuple[int, str, dict[str, Any]]) -> dict[str, Any]:
    index, word, raw_args = task
    word_root = Path(raw_args["word_root"])
    output_prefix = str(raw_args["output_prefix"])
    write_copy = bool(raw_args["write_copy"])
    config = HandRepairConfig(**raw_args["config"])
    source_path = word_root / f"{word}.json"
    if not source_path.exists():
        return {
            "word": word,
            "index": index,
            "status": "failed",
            "reason": "source_missing",
            "source": str(source_path),
        }

    try:
        payload = load_json(source_path)
        sample = payload.get("sample") or {}
        keypoints = sample.get("keypoints") or {}
        image_2d = keypoints.get("image_2d") or {}
        pose_frames = values_for(image_2d, "pose")
        left_frames = values_for(image_2d, "left_hand")
        right_frames = values_for(image_2d, "right_hand")
        face_frames = values_for(image_2d, "face")
        if not pose_frames or not left_frames or not right_frames:
            return {
                "word": word,
                "index": index,
                "status": "skipped",
                "reason": "missing_required_image_2d_parts",
                "source": str(source_path),
            }

        repair = repair_2d_hand_keypoints(pose_frames, left_frames, right_frames, config)
        output = copy.deepcopy(payload)
        output_word = f"{output_prefix}_{index:02d}_{word}"
        output["word"] = output_word
        output_sample = output.setdefault("sample", {})
        output_keypoints = output_sample.setdefault("keypoints", {})
        output_image_2d = copy.deepcopy(image_2d)
        output_image_2d["pose"] = copy.deepcopy(image_2d.get("pose") or shape_block(pose_frames, 25))
        if "face" in image_2d:
            output_image_2d["face"] = copy.deepcopy(image_2d["face"])
        elif face_frames:
            output_image_2d["face"] = shape_block(face_frames, 68)
        output_image_2d["left_hand"] = shape_block(repair.left_hand, 21)
        output_image_2d["right_hand"] = shape_block(repair.right_hand, 21)
        output_keypoints["image_2d"] = output_image_2d
        output_sample.setdefault("processing", {})["image_2d_repair_method"] = "hand_keypoint_structure_repair_v1"
        output["viewer_qa_alias"] = {
            "source_word": word,
            "source_file": source_path.name,
            "qa_kind": output_prefix,
        }
        output_path = word_root / f"{output_word}.json"
        if write_copy:
            write_json(output_path, output)
        return {
            "word": word,
            "index": index,
            "output_word": output_word,
            "source": str(source_path),
            "output": str(output_path),
            "status": "written" if write_copy else "dry_run",
            "frame_count": max(len(pose_frames), len(left_frames), len(right_frames)),
            "has_face": bool(face_frames),
            "stats": repair.stats,
            "top_frame_risks": [
                {"word": output_word, **risk}
                for risk in repair.top_frame_risks[:30]
            ],
        }
    except Exception as exc:  # noqa: BLE001 - keep per-word failures in report.
        return {
            "word": word,
            "index": index,
            "status": "failed",
            "reason": type(exc).__name__,
            "message": str(exc),
            "source": str(source_path),
        }


def aggregate_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    success = [item for item in results if item["status"] in {"written", "dry_run"}]
    skipped = [item for item in results if item["status"] == "skipped"]
    failed = [item for item in results if item["status"] == "failed"]
    totals = {
        "detected_points": 0,
        "repaired_points": 0,
        "repaired_frames": 0,
        "cross_hand_risk_points": 0,
        "chain_violation_points": 0,
        "bone_violation_points": 0,
        "angle_violation_points": 0,
        "local_deviation_points": 0,
    }
    for item in success:
        stats = item.get("stats") or {}
        totals["detected_points"] += int(stats.get("total_detected_points", 0))
        totals["repaired_points"] += int(stats.get("total_repaired_points", 0))
        totals["repaired_frames"] += int(stats.get("total_repaired_frames", 0))
        totals["cross_hand_risk_points"] += int(stats.get("total_cross_hand_risk_points", 0))
        for side in ("left", "right"):
            side_stats = stats.get(side) or {}
            totals["chain_violation_points"] += int(side_stats.get("chain_order_violation_points", 0))
            totals["chain_violation_points"] += int(side_stats.get("chain_intrusion_points", 0))
            totals["bone_violation_points"] += int(side_stats.get("bone_violation_points", 0))
            totals["angle_violation_points"] += int(side_stats.get("angle_violation_points", 0))
            totals["local_deviation_points"] += int(side_stats.get("local_deviation_points", 0))
    return {
        "total_files": len(results),
        "processed_files": len(success),
        "skipped_files": len(skipped),
        "failed_files": len(failed),
        **totals,
    }


def collect_top_frames(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for result in results:
        frames.extend(result.get("top_frame_risks") or [])
    return sorted(frames, key=lambda item: item.get("severity", 0), reverse=True)[:limit]


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    summary = report["summary"]
    top_words = sorted(
        [item for item in report["results"] if item["status"] in {"written", "dry_run"}],
        key=lambda item: int((item.get("stats") or {}).get("total_repaired_points", 0)),
        reverse=True,
    )[:30]
    lines = [
        "# 2D Hand Keypoint Repair Summary",
        "",
        f"- Total files: `{summary['total_files']}`",
        f"- Processed files: `{summary['processed_files']}`",
        f"- Skipped files: `{summary['skipped_files']}`",
        f"- Failed files: `{summary['failed_files']}`",
        f"- Detected points: `{summary['detected_points']}`",
        f"- Repaired points: `{summary['repaired_points']}`",
        f"- Cross-hand risk points: `{summary['cross_hand_risk_points']}`",
        "",
        "## Top Repaired Words",
        "",
        "| Rank | Word | Frames | Detected | Repaired | Cross-Hand | Bone | Chain | Max Jump Before | Max Jump After |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rank, item in enumerate(top_words, start=1):
        stats = item.get("stats") or {}
        left = stats.get("left") or {}
        right = stats.get("right") or {}
        before = max(float(left.get("max_joint_jump_before", 0.0)), float(right.get("max_joint_jump_before", 0.0)))
        after = max(float(left.get("max_joint_jump_after", 0.0)), float(right.get("max_joint_jump_after", 0.0)))
        chain = (
            int(left.get("chain_order_violation_points", 0))
            + int(left.get("chain_intrusion_points", 0))
            + int(right.get("chain_order_violation_points", 0))
            + int(right.get("chain_intrusion_points", 0))
        )
        bone = int(left.get("bone_violation_points", 0)) + int(right.get("bone_violation_points", 0))
        lines.append(
            "| "
            f"{rank} | {item.get('output_word', item.get('word'))} | {item.get('frame_count', 0)} | "
            f"{stats.get('total_detected_points', 0)} | "
            f"{stats.get('total_repaired_points', 0)} | "
            f"{stats.get('total_cross_hand_risk_points', 0)} | "
            f"{bone} | {chain} | {before:.3f} | {after:.3f} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_copy = args.write_copy and not args.dry_run
    if args.clean and write_copy:
        for path in args.word_root.glob(f"{args.output_prefix}_*.json"):
            path.unlink()

    words = load_selected_words(args.selection_json, args.word_root, args.include_pattern, args.limit)
    config = config_from_args(args)
    raw_args = {
        "word_root": args.word_root,
        "output_prefix": args.output_prefix,
        "write_copy": write_copy,
        "config": config.__dict__,
    }
    tasks = [(index, word, raw_args) for index, word in enumerate(words)]
    if args.workers > 1 and len(tasks) > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            results = list(executor.map(process_word, tasks))
    else:
        results = [process_word(task) for task in tasks]
    results.sort(key=lambda item: int(item.get("index", 0)))

    top_frames = collect_top_frames(results, args.top_frame_limit)
    report = {
        "schema_version": "hand-keypoint-2d-repair/v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "word_root": str(args.word_root),
            "selection_json": str(args.selection_json),
            "include_pattern": args.include_pattern,
            "output_dir": str(args.output_dir),
            "output_prefix": args.output_prefix,
            "write_copy": write_copy,
            "workers": args.workers,
            "repair": config.__dict__,
        },
        "summary": aggregate_summary(results),
        "results": results,
    }
    report_path = args.output_dir / "2d_hand_repair_report.json"
    top_frames_path = args.output_dir / "2d_hand_repair_top_frames.jsonl"
    write_json(report_path, report)
    top_frames_path.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in top_frames) + ("\n" if top_frames else ""),
        encoding="utf-8",
    )
    markdown_path = None
    if args.markdown:
        markdown_path = args.output_dir / "2d_hand_repair_summary.md"
        write_markdown(markdown_path, report)

    print(json.dumps({
        "selected_count": len(words),
        "processed_count": report["summary"]["processed_files"],
        "skipped_count": report["summary"]["skipped_files"],
        "failed_count": report["summary"]["failed_files"],
        "report": str(report_path),
        "top_frames": str(top_frames_path),
        "markdown": str(markdown_path) if markdown_path else None,
    }, ensure_ascii=False, indent=2))
    return 0 if report["summary"]["failed_files"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
