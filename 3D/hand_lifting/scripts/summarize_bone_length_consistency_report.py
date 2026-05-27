#!/usr/bin/env python3
"""Build a compact summary from a bone length consistency report.

This keeps large validation reports out of the model/context path. It reads the
full JSON produced by validate_bone_length_consistency.py and writes a small
summary JSON plus an optional Markdown review file.

Example:
    python scripts/summarize_bone_length_consistency_report.py \
        --report artifacts/bone_length_consistency_F_smoke/bone_length_consistency_report.json \
        --markdown
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


DEFAULT_TOP_LIMIT = 20


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Summarize a large bone_length_consistency_report.json."
    )
    parser.add_argument(
        "--report",
        required=True,
        type=Path,
        help="Path to bone_length_consistency_report.json.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help=(
            "Output compact JSON path. Defaults to "
            "<report_dir>/bone_length_consistency_summary.json."
        ),
    )
    parser.add_argument(
        "--markdown",
        action="store_true",
        help="Also write <summary_stem>.md next to the summary JSON.",
    )
    parser.add_argument(
        "--top-limit",
        default=DEFAULT_TOP_LIMIT,
        type=int,
        help=f"Number of worst rows to keep. Default: {DEFAULT_TOP_LIMIT}.",
    )
    parser.add_argument(
        "--max-unstable-ratio",
        default=0.20,
        type=float,
        help="Fail verdict when unstable aggregate bone ratio exceeds this value.",
    )
    parser.add_argument(
        "--max-invalid-frame-ratio",
        default=0.0,
        type=float,
        help="Fail verdict when invalid frame ratio exceeds this value.",
    )
    return parser.parse_args()


def load_report(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fp:
        payload = json.load(fp)
    if not isinstance(payload, dict):
        raise ValueError(f"Report root must be a JSON object: {path}")
    return payload


def safe_ratio(numerator: int | float, denominator: int | float) -> float | None:
    if denominator == 0:
        return None
    return round(float(numerator) / float(denominator), 6)


def rounded(value: Any, digits: int = 6) -> Any:
    if isinstance(value, float):
        return round(value, digits)
    return value


def sorted_status_counts(counter: Counter[str]) -> dict[str, int]:
    order = {"good": 0, "watch": 1, "unstable": 2, "insufficient_data": 3}
    return {
        key: counter[key]
        for key in sorted(counter, key=lambda item: (order.get(item, 99), item))
    }


def compact_stats(stats: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "valid_count",
        "mean_mm",
        "std_mm",
        "cv",
        "min_mm",
        "max_mm",
        "median_mm",
        "mad_mm",
        "p05_mm",
        "p95_mm",
        "status",
    )
    return {key: rounded(stats.get(key)) for key in keys if key in stats}


def aggregate_rows(aggregate: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for bone, stats in aggregate.items():
        if not isinstance(stats, dict):
            continue
        rows.append({"bone": bone, **compact_stats(stats)})
    return rows


def worst_aggregate_bones(aggregate: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    rows = aggregate_rows(aggregate)
    rows = [row for row in rows if row.get("cv") is not None]
    return sorted(
        rows,
        key=lambda row: (row.get("cv") or -1.0, row.get("std_mm") or -1.0),
        reverse=True,
    )[:limit]


def sequence_overview(sequences: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sequence in sequences:
        if not isinstance(sequence, dict):
            continue

        frame_count = int(sequence.get("frame_count") or 0)
        invalid_frame_count = int(sequence.get("invalid_frame_count") or 0)
        hand_counts = sequence.get("hand_valid_frame_counts") or {}
        left_valid = int(hand_counts.get("left") or 0)
        right_valid = int(hand_counts.get("right") or 0)
        status_counts = sequence.get("status_counts") or {}
        unstable_count = int(status_counts.get("unstable") or 0)
        bone_count = sum(int(value or 0) for value in status_counts.values())

        rows.append(
            {
                "sequence_id": sequence.get("sequence_id"),
                "frame_count": frame_count,
                "invalid_frame_count": invalid_frame_count,
                "invalid_frame_ratio": safe_ratio(invalid_frame_count, frame_count),
                "left_valid_frame_ratio": safe_ratio(left_valid, frame_count),
                "right_valid_frame_ratio": safe_ratio(right_valid, frame_count),
                "bone_count": bone_count,
                "unstable_bone_count": unstable_count,
                "unstable_bone_ratio": safe_ratio(unstable_count, bone_count),
                "status_counts": dict(status_counts),
            }
        )

    return sorted(
        rows,
        key=lambda row: (
            row.get("unstable_bone_ratio") or 0.0,
            row.get("invalid_frame_ratio") or 0.0,
        ),
        reverse=True,
    )[:limit]


def collect_totals(
    aggregate: dict[str, Any], sequences: list[dict[str, Any]]
) -> dict[str, Any]:
    aggregate_status_counts: Counter[str] = Counter()
    for stats in aggregate.values():
        if isinstance(stats, dict):
            aggregate_status_counts[str(stats.get("status", "unknown"))] += 1

    total_frames = 0
    total_invalid_frames = 0
    hand_valid_frames = Counter()
    coordinate_unit_frames = Counter()
    sequence_status_counts: Counter[str] = Counter()
    sequence_bone_count = 0

    for sequence in sequences:
        if not isinstance(sequence, dict):
            continue
        frame_count = int(sequence.get("frame_count") or 0)
        total_frames += frame_count
        total_invalid_frames += int(sequence.get("invalid_frame_count") or 0)
        for hand, count in (sequence.get("hand_valid_frame_counts") or {}).items():
            hand_valid_frames[str(hand)] += int(count or 0)
        for unit, count in (sequence.get("coordinate_unit_frame_counts") or {}).items():
            coordinate_unit_frames[str(unit)] += int(count or 0)
        for status, count in (sequence.get("status_counts") or {}).items():
            sequence_status_counts[str(status)] += int(count or 0)
            sequence_bone_count += int(count or 0)

    aggregate_bone_count = sum(aggregate_status_counts.values())
    unstable_aggregate_count = aggregate_status_counts.get("unstable", 0)
    unstable_sequence_count = sequence_status_counts.get("unstable", 0)

    return {
        "sequence_count": len(sequences),
        "total_frames": total_frames,
        "total_invalid_frames": total_invalid_frames,
        "invalid_frame_ratio": safe_ratio(total_invalid_frames, total_frames),
        "hand_valid_frame_ratios": {
            hand: safe_ratio(count, total_frames)
            for hand, count in sorted(hand_valid_frames.items())
        },
        "coordinate_unit_frame_counts": dict(sorted(coordinate_unit_frames.items())),
        "aggregate_bone_count": aggregate_bone_count,
        "aggregate_status_counts": sorted_status_counts(aggregate_status_counts),
        "aggregate_unstable_ratio": safe_ratio(
            unstable_aggregate_count, aggregate_bone_count
        ),
        "sequence_bone_observation_count": sequence_bone_count,
        "sequence_status_counts": sorted_status_counts(sequence_status_counts),
        "sequence_unstable_ratio": safe_ratio(
            unstable_sequence_count, sequence_bone_count
        ),
    }


def make_verdict(
    totals: dict[str, Any],
    max_unstable_ratio: float,
    max_invalid_frame_ratio: float,
) -> dict[str, Any]:
    reasons: list[str] = []
    unstable_ratio = totals.get("aggregate_unstable_ratio")
    invalid_frame_ratio = totals.get("invalid_frame_ratio")

    if unstable_ratio is not None and unstable_ratio > max_unstable_ratio:
        reasons.append(
            "aggregate_unstable_ratio "
            f"{unstable_ratio:.6f} > {max_unstable_ratio:.6f}"
        )
    if invalid_frame_ratio is not None and invalid_frame_ratio > max_invalid_frame_ratio:
        reasons.append(
            "invalid_frame_ratio "
            f"{invalid_frame_ratio:.6f} > {max_invalid_frame_ratio:.6f}"
        )

    return {
        "status": "fail" if reasons else "pass",
        "reasons": reasons,
        "thresholds": {
            "max_unstable_ratio": max_unstable_ratio,
            "max_invalid_frame_ratio": max_invalid_frame_ratio,
        },
    }


def make_summary(
    report: dict[str, Any],
    source_path: Path,
    top_limit: int,
    max_unstable_ratio: float,
    max_invalid_frame_ratio: float,
) -> dict[str, Any]:
    aggregate = report.get("aggregate") or {}
    sequences = report.get("sequences") or []
    if not isinstance(aggregate, dict):
        raise ValueError("Report field 'aggregate' must be an object.")
    if not isinstance(sequences, list):
        raise ValueError("Report field 'sequences' must be an array.")

    totals = collect_totals(aggregate, sequences)
    histogram_files = report.get("histogram_files") or []

    return {
        "source_report": str(source_path),
        "config": report.get("config", {}),
        "verdict": make_verdict(
            totals=totals,
            max_unstable_ratio=max_unstable_ratio,
            max_invalid_frame_ratio=max_invalid_frame_ratio,
        ),
        "totals": totals,
        "worst_aggregate_bones_by_cv": worst_aggregate_bones(aggregate, top_limit),
        "worst_sequence_bones_by_cv": (report.get("summary") or {}).get(
            "worst_bones_by_cv", []
        )[:top_limit],
        "worst_sequences": sequence_overview(sequences, top_limit),
        "histogram_files": histogram_files[:top_limit],
    }


def markdown_table(rows: list[dict[str, Any]], columns: list[str]) -> list[str]:
    lines = [
        "| " + " | ".join(columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(column, "")) for column in columns) + " |")
    return lines


def write_markdown(summary: dict[str, Any], path: Path) -> None:
    verdict = summary["verdict"]
    totals = summary["totals"]
    lines = [
        "# Bone Length Consistency Summary",
        "",
        f"- Source: `{summary['source_report']}`",
        f"- Verdict: **{verdict['status']}**",
        f"- Sequences: {totals['sequence_count']}",
        f"- Frames: {totals['total_frames']}",
        f"- Invalid frame ratio: {totals['invalid_frame_ratio']}",
        f"- Coordinate unit frame counts: `{totals['coordinate_unit_frame_counts']}`",
        f"- Aggregate unstable ratio: {totals['aggregate_unstable_ratio']}",
        f"- Aggregate status counts: `{totals['aggregate_status_counts']}`",
        "",
    ]

    if verdict["reasons"]:
        lines.extend(["## Verdict Reasons", ""])
        lines.extend(f"- {reason}" for reason in verdict["reasons"])
        lines.append("")

    lines.extend(["## Worst Aggregate Bones", ""])
    lines.extend(
        markdown_table(
            summary["worst_aggregate_bones_by_cv"],
            ["bone", "cv", "std_mm", "mean_mm", "valid_count", "status"],
        )
    )
    lines.append("")

    lines.extend(["## Worst Sequences", ""])
    lines.extend(
        markdown_table(
            summary["worst_sequences"],
            [
                "sequence_id",
                "frame_count",
                "invalid_frame_ratio",
                "unstable_bone_ratio",
                "status_counts",
            ],
        )
    )
    lines.append("")

    if summary["histogram_files"]:
        lines.extend(["## Histogram Files", ""])
        lines.extend(f"- `{path}`" for path in summary["histogram_files"])
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    report_path: Path = args.report
    output_path: Path = args.output or (
        report_path.parent / "bone_length_consistency_summary.json"
    )

    report = load_report(report_path)
    summary = make_summary(
        report=report,
        source_path=report_path,
        top_limit=max(args.top_limit, 0),
        max_unstable_ratio=args.max_unstable_ratio,
        max_invalid_frame_ratio=args.max_invalid_frame_ratio,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)

    if args.markdown:
        write_markdown(summary, output_path.with_suffix(".md"))

    print(f"Summary: {output_path}")
    print(f"Verdict: {summary['verdict']['status']}")
    if args.markdown:
        print(f"Markdown: {output_path.with_suffix('.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
