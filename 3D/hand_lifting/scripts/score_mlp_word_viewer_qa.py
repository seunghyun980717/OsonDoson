#!/usr/bin/env python3
"""Score word JSON files for hand-lifting viewer QA risk.

The script reads word JSON files rendered by the viewer, computes simple
geometry and confidence checks over a selected 3D keypoint space, and writes
reports that help decide which words/frames need manual viewer QA. It does
not modify source word JSON files or viewer source.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
THREE_D_ROOT = SCRIPT_DIR.parents[1]

BODY25_LEFT_SHOULDER = 5
BODY25_LEFT_ELBOW = 6
BODY25_LEFT_WRIST = 7
BODY25_RIGHT_SHOULDER = 2
BODY25_RIGHT_ELBOW = 3
BODY25_RIGHT_WRIST = 4
HAND_JOINT_COUNT = 21
HAND_ORDER = ("left", "right")
HAND_PART_NAMES = {"left": "left_hand", "right": "right_hand"}
HAND_WRIST_INDEX = 0
FINGER_JOINT_INDICES = (1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20)
PALM_JOINT_INDICES = (5, 9, 13, 17)
HAND_BONES = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (0, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (0, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (0, 17),
    (17, 18),
    (18, 19),
    (19, 20),
)


@dataclass
class Thresholds:
    finger_z_jump: float = 0.18
    finger_min_angle_deg: float = 105.0
    wrist_z_jump: float = 0.20
    finger_bone_cv: float = 0.35
    finger_bone_max_ratio: float = 2.0
    elbow_min_angle_deg: float = 25.0
    elbow_angle_jump_deg: float = 45.0
    low_hand_confidence: float = 0.2
    missing_hand_ratio: float = 0.3
    hand_position_jump: float = 0.25


@dataclass
class ScanConfig:
    word_root: str
    output_dir: str
    include_pattern: str
    keypoint_space: str
    require_estimated_3d: bool
    workers: int
    top_limit: int
    frame_top_limit: int
    markdown: bool
    thresholds: Thresholds


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--word-root",
        type=Path,
        default=THREE_D_ROOT / "data" / "words",
        help="Word JSON root. Default: 3D/data/words.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=THREE_D_ROOT / "hand_lifting" / "runs" / "viewer_qa",
        help="Directory for QA risk reports.",
    )
    parser.add_argument("--include-pattern", default="*.json", help="Glob pattern under word-root.")
    parser.add_argument(
        "--keypoint-space",
        default="estimated_3d",
        choices=("estimated_3d", "postprocessed_3d"),
        help="3D keypoint space to score. Use postprocessed_3d for candidate postprocessing QA.",
    )
    parser.add_argument(
        "--require-estimated-3d",
        action="store_true",
        help="Skip files unless sample.spaces.estimated_3d.available is true.",
    )
    parser.add_argument("--workers", type=int, default=8, help="Parallel JSON workers. Use 1 for serial.")
    parser.add_argument("--top-limit", type=int, default=50, help="Number of top words in reports.")
    parser.add_argument("--frame-top-limit", type=int, default=200, help="Number of top frame risks in JSONL.")
    parser.add_argument("--markdown", action="store_true", help="Write a Markdown summary.")
    parser.add_argument("--finger-z-jump-threshold", type=float, default=0.18)
    parser.add_argument(
        "--finger-min-angle-deg",
        type=float,
        default=105.0,
        help="Flag finger joint angles below this value. Helps catch static folded-finger artifacts.",
    )
    parser.add_argument("--wrist-z-jump-threshold", type=float, default=0.20)
    parser.add_argument("--finger-bone-cv-threshold", type=float, default=0.35)
    parser.add_argument("--finger-bone-max-ratio-threshold", type=float, default=2.0)
    parser.add_argument("--elbow-min-angle-deg", type=float, default=25.0)
    parser.add_argument("--elbow-angle-jump-threshold-deg", type=float, default=45.0)
    parser.add_argument("--low-hand-confidence-threshold", type=float, default=0.2)
    parser.add_argument("--missing-hand-ratio-threshold", type=float, default=0.3)
    parser.add_argument("--hand-position-jump-threshold", type=float, default=0.25)
    return parser.parse_args()


def finite_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def safe_point(frame: Any, index: int, dims: int) -> list[float] | None:
    if not isinstance(frame, list) or index >= len(frame) or not isinstance(frame[index], list):
        return None
    point = frame[index]
    if len(point) < dims:
        return None
    values: list[float] = []
    for dim in range(dims):
        value = finite_float(point[dim])
        if value is None:
            return None
        values.append(value)
    return values


def vector_distance(a: list[float] | None, b: list[float] | None) -> float | None:
    if a is None or b is None or len(a) < 3 or len(b) < 3:
        return None
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def angle_deg(a: list[float] | None, b: list[float] | None, c: list[float] | None) -> float | None:
    if a is None or b is None or c is None:
        return None
    ba = [a[i] - b[i] for i in range(3)]
    bc = [c[i] - b[i] for i in range(3)]
    ba_len = math.sqrt(sum(value * value for value in ba))
    bc_len = math.sqrt(sum(value * value for value in bc))
    if ba_len <= 1e-9 or bc_len <= 1e-9:
        return None
    dot = sum(ba[i] * bc[i] for i in range(3)) / (ba_len * bc_len)
    return math.degrees(math.acos(max(-1.0, min(1.0, dot))))


def values_for(block: dict[str, Any], part_name: str) -> list[Any]:
    values = ((block or {}).get(part_name) or {}).get("values")
    return values if isinstance(values, list) else []


def confidence_stats(hand_2d_frames: list[Any]) -> dict[str, float]:
    confidences: list[float] = []
    missing = 0
    total = 0
    for frame in hand_2d_frames:
        for joint_index in range(HAND_JOINT_COUNT):
            point = safe_point(frame, joint_index, 3)
            total += 1
            if point is None or point[2] <= 1e-9:
                missing += 1
            else:
                confidences.append(point[2])
    mean_conf = statistics.fmean(confidences) if confidences else 0.0
    return {
        "mean_confidence": round(mean_conf, 6),
        "missing_ratio": round(missing / total, 6) if total else 1.0,
    }


def append_risk(
    frame_risks: list[dict[str, Any]],
    risk_type: str,
    word: str,
    frame_index: int,
    value: float,
    threshold: float,
    hand: str | None = None,
    joint: int | None = None,
    detail: str | None = None,
) -> None:
    frame_risks.append(
        {
            "word": word,
            "frame_index": frame_index,
            "risk_type": risk_type,
            "hand": hand,
            "joint": joint,
            "value": round(value, 6),
            "threshold": round(threshold, 6),
            "severity": round(value / threshold, 6) if threshold > 0 else round(value, 6),
            "detail": detail,
        }
    )


def update_max(metrics: dict[str, float], key: str, value: float) -> None:
    metrics[key] = round(max(metrics.get(key, 0.0), value), 6)


def scan_temporal_hand_risks(
    word: str,
    hand: str,
    frames: list[Any],
    image_2d_frames: list[Any],
    thresholds: Thresholds,
    metrics: dict[str, float],
    frame_risks: list[dict[str, Any]],
) -> None:
    conf_stats = confidence_stats(image_2d_frames)
    metrics[f"{hand}_mean_confidence"] = conf_stats["mean_confidence"]
    metrics[f"{hand}_missing_ratio"] = conf_stats["missing_ratio"]
    if conf_stats["mean_confidence"] < thresholds.low_hand_confidence:
        append_risk(
            frame_risks,
            "low_hand_confidence",
            word,
            0,
            thresholds.low_hand_confidence - conf_stats["mean_confidence"],
            thresholds.low_hand_confidence,
            hand,
            detail=f"mean_confidence={conf_stats['mean_confidence']}",
        )
    if conf_stats["missing_ratio"] > thresholds.missing_hand_ratio:
        append_risk(
            frame_risks,
            "missing_hand_ratio",
            word,
            0,
            conf_stats["missing_ratio"],
            thresholds.missing_hand_ratio,
            hand,
        )

    bone_lengths: dict[tuple[int, int], list[float]] = {bone: [] for bone in HAND_BONES}
    previous_wrist: list[float] | None = None
    previous_palm_center: list[float] | None = None
    previous_z_by_joint: dict[int, float] = {}

    for frame_index, frame in enumerate(frames):
        wrist = safe_point(frame, HAND_WRIST_INDEX, 3)
        palm_points = [safe_point(frame, joint_index, 3) for joint_index in (0, *PALM_JOINT_INDICES)]
        valid_palm_points = [point for point in palm_points if point is not None]
        palm_center = None
        if valid_palm_points:
            palm_center = [
                statistics.fmean(point[axis] for point in valid_palm_points)
                for axis in range(3)
            ]

        if previous_wrist is not None and wrist is not None:
            wrist_z_jump = abs(wrist[2] - previous_wrist[2])
            update_max(metrics, f"{hand}_wrist_z_jump_max", wrist_z_jump)
            if wrist_z_jump > thresholds.wrist_z_jump:
                append_risk(
                    frame_risks,
                    "wrist_z_jump",
                    word,
                    frame_index,
                    wrist_z_jump,
                    thresholds.wrist_z_jump,
                    hand,
                    HAND_WRIST_INDEX,
                )
            wrist_move = vector_distance(wrist, previous_wrist)
            if wrist_move is not None:
                update_max(metrics, f"{hand}_hand_position_jump_max", wrist_move)
                if wrist_move > thresholds.hand_position_jump:
                    append_risk(
                        frame_risks,
                        "hand_position_jump",
                        word,
                        frame_index,
                        wrist_move,
                        thresholds.hand_position_jump,
                        hand,
                        HAND_WRIST_INDEX,
                        detail="wrist",
                    )

        if previous_palm_center is not None and palm_center is not None:
            palm_move = vector_distance(palm_center, previous_palm_center)
            if palm_move is not None:
                update_max(metrics, f"{hand}_palm_position_jump_max", palm_move)
                if palm_move > thresholds.hand_position_jump:
                    append_risk(
                        frame_risks,
                        "hand_position_jump",
                        word,
                        frame_index,
                        palm_move,
                        thresholds.hand_position_jump,
                        hand,
                        detail="palm_center",
                    )

        for joint_index in FINGER_JOINT_INDICES:
            point = safe_point(frame, joint_index, 3)
            if point is None:
                continue
            previous_z = previous_z_by_joint.get(joint_index)
            if previous_z is not None:
                z_jump = abs(point[2] - previous_z)
                update_max(metrics, f"{hand}_finger_z_jump_max", z_jump)
                if z_jump > thresholds.finger_z_jump:
                    append_risk(
                        frame_risks,
                        "finger_z_jump",
                        word,
                        frame_index,
                        z_jump,
                        thresholds.finger_z_jump,
                        hand,
                        joint_index,
                    )
            previous_z_by_joint[joint_index] = point[2]

        finger_chains = (
            (0, 1, 2, 3, 4),
            (0, 5, 6, 7, 8),
            (0, 9, 10, 11, 12),
            (0, 13, 14, 15, 16),
            (0, 17, 18, 19, 20),
        )
        for chain in finger_chains:
            for start_index, mid_index, end_index in zip(chain, chain[1:], chain[2:]):
                current_angle = angle_deg(
                    safe_point(frame, start_index, 3),
                    safe_point(frame, mid_index, 3),
                    safe_point(frame, end_index, 3),
                )
                if current_angle is None:
                    continue
                low_angle_risk = max(0.0, thresholds.finger_min_angle_deg - current_angle)
                update_max(metrics, f"{hand}_finger_low_angle_risk_max", low_angle_risk)
                if current_angle < thresholds.finger_min_angle_deg:
                    append_risk(
                        frame_risks,
                        "finger_angle_risk",
                        word,
                        frame_index,
                        low_angle_risk,
                        thresholds.finger_min_angle_deg,
                        hand,
                        mid_index,
                        detail=f"angle={round(current_angle, 3)}",
                    )

        for bone in HAND_BONES:
            start = safe_point(frame, bone[0], 3)
            end = safe_point(frame, bone[1], 3)
            length = vector_distance(start, end)
            if length is not None and length > 1e-9:
                bone_lengths[bone].append(length)

        previous_wrist = wrist
        previous_palm_center = palm_center

    for bone, lengths in bone_lengths.items():
        if len(lengths) < 3:
            continue
        mean_length = statistics.fmean(lengths)
        if mean_length <= 1e-9:
            continue
        cv = statistics.pstdev(lengths) / mean_length
        median_length = statistics.median(lengths)
        max_ratio = max(lengths) / median_length if median_length > 1e-9 else 0.0
        update_max(metrics, f"{hand}_finger_bone_cv_max", cv)
        update_max(metrics, f"{hand}_finger_bone_max_ratio", max_ratio)
        if cv > thresholds.finger_bone_cv:
            append_risk(
                frame_risks,
                "finger_bone_cv",
                word,
                0,
                cv,
                thresholds.finger_bone_cv,
                hand,
                detail=f"bone={bone[0]}-{bone[1]}",
            )
        if max_ratio > thresholds.finger_bone_max_ratio:
            append_risk(
                frame_risks,
                "finger_bone_max_ratio",
                word,
                0,
                max_ratio,
                thresholds.finger_bone_max_ratio,
                hand,
                detail=f"bone={bone[0]}-{bone[1]}",
            )


def scan_elbow_risks(
    word: str,
    pose_frames: list[Any],
    thresholds: Thresholds,
    metrics: dict[str, float],
    frame_risks: list[dict[str, Any]],
) -> None:
    sides = {
        "left": (BODY25_LEFT_SHOULDER, BODY25_LEFT_ELBOW, BODY25_LEFT_WRIST),
        "right": (BODY25_RIGHT_SHOULDER, BODY25_RIGHT_ELBOW, BODY25_RIGHT_WRIST),
    }
    for side, (shoulder_index, elbow_index, wrist_index) in sides.items():
        previous_angle: float | None = None
        for frame_index, frame in enumerate(pose_frames):
            shoulder = safe_point(frame, shoulder_index, 3)
            elbow = safe_point(frame, elbow_index, 3)
            wrist = safe_point(frame, wrist_index, 3)
            current_angle = angle_deg(shoulder, elbow, wrist)
            if current_angle is None:
                continue
            low_angle_risk = max(0.0, thresholds.elbow_min_angle_deg - current_angle)
            update_max(metrics, f"{side}_elbow_low_angle_risk_max", low_angle_risk)
            if current_angle < thresholds.elbow_min_angle_deg:
                append_risk(
                    frame_risks,
                    "elbow_angle_risk",
                    word,
                    frame_index,
                    low_angle_risk,
                    thresholds.elbow_min_angle_deg,
                    side,
                    elbow_index,
                    detail=f"angle={round(current_angle, 3)}",
                )
            if previous_angle is not None:
                angle_jump = abs(current_angle - previous_angle)
                update_max(metrics, f"{side}_elbow_angle_jump_max", angle_jump)
                if angle_jump > thresholds.elbow_angle_jump_deg:
                    append_risk(
                        frame_risks,
                        "elbow_angle_jump",
                        word,
                        frame_index,
                        angle_jump,
                        thresholds.elbow_angle_jump_deg,
                        side,
                        elbow_index,
                    )
            previous_angle = current_angle


def scan_word(path: Path, thresholds: Thresholds, require_estimated_3d: bool, keypoint_space: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as error:  # noqa: BLE001 - report per-file failures without stopping the scan.
        return {"status": "error", "path": str(path), "word": path.stem, "reason": f"json_read_error: {error}"}

    word = str(payload.get("word") or path.stem)
    sample = payload.get("sample") if isinstance(payload.get("sample"), dict) else {}
    spaces = sample.get("spaces") if isinstance(sample.get("spaces"), dict) else {}
    estimated_space = spaces.get("estimated_3d") if isinstance(spaces.get("estimated_3d"), dict) else {}
    keypoints = sample.get("keypoints") if isinstance(sample.get("keypoints"), dict) else {}
    keypoint_3d = keypoints.get(keypoint_space) if isinstance(keypoints.get(keypoint_space), dict) else {}
    image_2d = keypoints.get("image_2d") if isinstance(keypoints.get("image_2d"), dict) else {}

    if require_estimated_3d and estimated_space.get("available") is not True:
        return {"status": "skipped", "path": str(path), "word": word, "reason": "estimated_3d_not_available"}
    if not keypoint_3d:
        return {"status": "skipped", "path": str(path), "word": word, "reason": f"missing_{keypoint_space}_keypoints"}

    pose_frames = values_for(keypoint_3d, "pose")
    left_frames = values_for(keypoint_3d, "left_hand")
    right_frames = values_for(keypoint_3d, "right_hand")
    left_2d_frames = values_for(image_2d, "left_hand")
    right_2d_frames = values_for(image_2d, "right_hand")
    frame_counts = {
        "pose": len(pose_frames),
        "left_hand": len(left_frames),
        "right_hand": len(right_frames),
        "left_hand_2d": len(left_2d_frames),
        "right_hand_2d": len(right_2d_frames),
    }
    expected_frame_count = max(frame_counts.values()) if frame_counts else 0
    metrics: dict[str, float] = {}
    frame_risks: list[dict[str, Any]] = []

    if len(set(frame_counts.values())) > 1:
        append_risk(
            frame_risks,
            "non_finite_or_missing_3d",
            word,
            0,
            1.0,
            1.0,
            detail=f"frame_count_mismatch={frame_counts}",
        )

    finite_failures = 0
    for part_name, frames in (("pose", pose_frames), ("left_hand", left_frames), ("right_hand", right_frames)):
        expected_joints = 25 if part_name == "pose" else HAND_JOINT_COUNT
        for frame_index, frame in enumerate(frames):
            for joint_index in range(expected_joints):
                if safe_point(frame, joint_index, 3) is None:
                    finite_failures += 1
                    append_risk(
                        frame_risks,
                        "non_finite_or_missing_3d",
                        word,
                        frame_index,
                        1.0,
                        1.0,
                        part_name,
                        joint_index,
                    )
                    break
    metrics["non_finite_or_missing_3d_count"] = finite_failures

    scan_temporal_hand_risks(
        word,
        "left",
        left_frames,
        left_2d_frames,
        thresholds,
        metrics,
        frame_risks,
    )
    scan_temporal_hand_risks(
        word,
        "right",
        right_frames,
        right_2d_frames,
        thresholds,
        metrics,
        frame_risks,
    )
    scan_elbow_risks(word, pose_frames, thresholds, metrics, frame_risks)

    risk_counts: dict[str, int] = {}
    risk_score = 0.0
    for risk in frame_risks:
        risk_type = str(risk["risk_type"])
        risk_counts[risk_type] = risk_counts.get(risk_type, 0) + 1
        risk_score += float(risk.get("severity") or 0.0)

    top_frame_risks = sorted(
        frame_risks,
        key=lambda item: (float(item.get("severity") or 0.0), float(item.get("value") or 0.0)),
        reverse=True,
    )[:25]

    return {
        "status": "ok",
        "path": str(path),
        "word": word,
        "frame_count": expected_frame_count,
        "frame_counts": frame_counts,
        "risk_score": round(risk_score, 6),
        "risk_counts": dict(sorted(risk_counts.items())),
        "metrics": metrics,
        "top_frame_risks": top_frame_risks,
    }


def aggregate_by_risk_type(words: list[dict[str, Any]], top_limit: int) -> dict[str, list[dict[str, Any]]]:
    risk_types = sorted({risk_type for word in words for risk_type in word.get("risk_counts", {})})
    output: dict[str, list[dict[str, Any]]] = {}
    for risk_type in risk_types:
        candidates = [
            {
                "word": word["word"],
                "risk_score": word["risk_score"],
                "count": word.get("risk_counts", {}).get(risk_type, 0),
                "path": word["path"],
            }
            for word in words
            if word.get("risk_counts", {}).get(risk_type, 0) > 0
        ]
        candidates.sort(key=lambda item: (item["count"], item["risk_score"]), reverse=True)
        output[risk_type] = candidates[:top_limit]
    return output


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> list[str]:
    lines = [
        "| " + " | ".join(title for title, _ in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(key, "")) for _, key in columns) + " |")
    return lines


def write_markdown_summary(path: Path, report: dict[str, Any]) -> None:
    summary = report["summary"]
    top_words = report["top_words"]
    by_type = report["by_risk_type"]
    verdict = "REVIEW_REQUIRED" if summary["risk_word_count"] else "PASS"

    lines = [
        f"# MLP Word Viewer QA Risk Summary",
        "",
        f"- Verdict: `{verdict}`",
        f"- Total files: {summary['total_files']}",
        f"- Scored files: {summary['scored_files']}",
        f"- Skipped files: {summary['skipped_files']}",
        f"- Error files: {summary['error_files']}",
        f"- Risk words: {summary['risk_word_count']}",
        "",
        "## Top Risk Words",
        "",
    ]
    lines.extend(
        markdown_table(
            top_words,
            [
                ("Rank", "rank"),
                ("Word", "word"),
                ("Risk Score", "risk_score"),
                ("Frame Count", "frame_count"),
                ("Risk Counts", "risk_counts"),
            ],
        )
    )
    lines.append("")
    for risk_type in (
        "finger_z_jump",
        "finger_angle_risk",
        "elbow_angle_risk",
        "elbow_angle_jump",
        "low_hand_confidence",
    ):
        lines.extend([f"## Top {risk_type}", ""])
        rows = by_type.get(risk_type, [])
        lines.extend(
            markdown_table(
                rows,
                [
                    ("Word", "word"),
                    ("Count", "count"),
                    ("Risk Score", "risk_score"),
                ],
            )
        )
        lines.append("")
    lines.extend(["## Viewer QA Priority", ""])
    for item in top_words[: min(20, len(top_words))]:
        lines.append(f"- {item['word']} - score {item['risk_score']} - {item['risk_counts']}")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def ranked_top_words(words: list[dict[str, Any]], top_limit: int) -> list[dict[str, Any]]:
    ranked = sorted(words, key=lambda item: item["risk_score"], reverse=True)[:top_limit]
    output = []
    for index, item in enumerate(ranked, start=1):
        output.append(
            {
                "rank": index,
                "word": item["word"],
                "risk_score": item["risk_score"],
                "frame_count": item["frame_count"],
                "risk_counts": item["risk_counts"],
                "path": item["path"],
                "metrics": item["metrics"],
                "top_frame_risks": item["top_frame_risks"],
            }
        )
    return output


def main() -> int:
    args = parse_args()
    thresholds = Thresholds(
        finger_z_jump=args.finger_z_jump_threshold,
        finger_min_angle_deg=args.finger_min_angle_deg,
        wrist_z_jump=args.wrist_z_jump_threshold,
        finger_bone_cv=args.finger_bone_cv_threshold,
        finger_bone_max_ratio=args.finger_bone_max_ratio_threshold,
        elbow_min_angle_deg=args.elbow_min_angle_deg,
        elbow_angle_jump_deg=args.elbow_angle_jump_threshold_deg,
        low_hand_confidence=args.low_hand_confidence_threshold,
        missing_hand_ratio=args.missing_hand_ratio_threshold,
        hand_position_jump=args.hand_position_jump_threshold,
    )
    config = ScanConfig(
        word_root=str(args.word_root),
        output_dir=str(args.output_dir),
        include_pattern=args.include_pattern,
        keypoint_space=args.keypoint_space,
        require_estimated_3d=args.require_estimated_3d,
        workers=args.workers,
        top_limit=args.top_limit,
        frame_top_limit=args.frame_top_limit,
        markdown=args.markdown,
        thresholds=thresholds,
    )

    paths = sorted(path for path in args.word_root.glob(args.include_pattern) if path.is_file())
    if not paths:
        raise FileNotFoundError(f"No word JSON files matched: {args.word_root / args.include_pattern}")

    results: list[dict[str, Any]] = []
    workers = max(1, int(args.workers))
    if workers == 1:
        for path in paths:
            results.append(scan_word(path, thresholds, args.require_estimated_3d, args.keypoint_space))
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(scan_word, path, thresholds, args.require_estimated_3d, args.keypoint_space): path
                for path in paths
            }
            for future in as_completed(futures):
                results.append(future.result())

    scored = [result for result in results if result.get("status") == "ok"]
    skipped = [result for result in results if result.get("status") == "skipped"]
    errors = [result for result in results if result.get("status") == "error"]
    risk_words = [result for result in scored if float(result.get("risk_score") or 0.0) > 0]
    top_words = ranked_top_words(risk_words, args.top_limit)
    by_risk_type = aggregate_by_risk_type(risk_words, args.top_limit)
    top_frames: list[dict[str, Any]] = []
    for word in scored:
        top_frames.extend(word.get("top_frame_risks") or [])
    top_frames.sort(
        key=lambda item: (float(item.get("severity") or 0.0), float(item.get("value") or 0.0)),
        reverse=True,
    )
    top_frames = top_frames[: args.frame_top_limit]

    report = {
        "schema_version": "hand-lifting-viewer-qa-risk/v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "config": asdict(config),
        "summary": {
            "total_files": len(paths),
            "scored_files": len(scored),
            "skipped_files": len(skipped),
            "error_files": len(errors),
            "risk_word_count": len(risk_words),
            "top_limit": args.top_limit,
            "frame_top_limit": args.frame_top_limit,
        },
        "skipped_by_reason": {
            reason: sum(1 for item in skipped if item.get("reason") == reason)
            for reason in sorted({str(item.get("reason")) for item in skipped})
        },
        "errors": errors[:100],
        "top_words": top_words,
        "by_risk_type": by_risk_type,
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "mlp_word_qa_risk_report.json"
    top_frames_path = args.output_dir / "mlp_word_qa_risk_top_frames.jsonl"
    summary_path = args.output_dir / "mlp_word_qa_risk_summary.md"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with top_frames_path.open("w", encoding="utf-8") as fp:
        for row in top_frames:
            fp.write(json.dumps(row, ensure_ascii=False) + "\n")
    if args.markdown:
        write_markdown_summary(summary_path, report)

    print(f"Report: {report_path}")
    print(f"Top frames: {top_frames_path}")
    if args.markdown:
        print(f"Markdown: {summary_path}")
    print(f"Scored: {len(scored)} / {len(paths)}")
    print(f"Risk words: {len(risk_words)}")
    if top_words:
        print(f"Top word: {top_words[0]['word']} score={top_words[0]['risk_score']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
