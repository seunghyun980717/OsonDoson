"""Filesystem-backed clip loading for word, phrase, and transition assets."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from .schemas import ALL_KEYS, KEY_OPTIONAL, KEY_REQUIRED, ClipAsset


BOUNDARY_MANIFEST_CANDIDATES = (
    "word-boundaries.json",
    "words/word-boundaries.json",
    "words/boundaries.json",
)


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=16)
def _manifest_for(asset_root_str: str, subdir: str) -> dict[str, Any]:
    manifest_path = Path(asset_root_str) / subdir / "manifest.json"
    if not manifest_path.exists():
        return {}
    return _load_json(manifest_path)


@lru_cache(maxsize=16)
def _word_boundaries_for(asset_root_str: str) -> dict[str, dict[str, Any]]:
    asset_root = Path(asset_root_str)
    for relative_path in BOUNDARY_MANIFEST_CANDIDATES:
        manifest_path = asset_root / relative_path
        if not manifest_path.exists():
            continue
        payload = _load_json(manifest_path)
        if "clips" in payload:
            return {str(entry["id"]): dict(entry) for entry in payload.get("clips", [])}
        return {str(key): dict(value) for key, value in payload.items()}
    return {}


def _index_clips(manifest: dict[str, Any], key: str = "clips") -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for entry in manifest.get(key, []):
        clip_id = entry["id"]
        indexed[str(clip_id)] = entry
    return indexed


def _index_transitions(manifest: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    indexed: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in manifest.get("transitions", []):
        indexed[(entry["prev_label"], entry["next_label"])] = entry
    return indexed


def _zeros_like_2d(frame_count: int, point_count: int) -> np.ndarray:
    arr = np.zeros((frame_count, point_count, 3), dtype=np.float32)
    arr[:, :, 2] = 0.0
    return arr


def _validate_required(npz_data: dict[str, np.ndarray], clip_id: str) -> None:
    missing = [key for key in KEY_REQUIRED if key not in npz_data]
    if missing:
        raise ValueError(f"Clip '{clip_id}' missing required arrays: {missing}")


def _coerce_arrays(npz_data: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    arrays: dict[str, np.ndarray] = {}
    for key, value in npz_data.items():
        arrays[key] = np.asarray(value, dtype=np.float32)

    _validate_required(arrays, npz_data.get("id", "unknown"))

    pose_frames, pose_points, _ = arrays["pose_3d"].shape
    left_frames, left_points, _ = arrays["left_hand_3d"].shape
    right_frames, right_points, _ = arrays["right_hand_3d"].shape

    if "pose_2d" not in arrays:
        arrays["pose_2d"] = _zeros_like_2d(pose_frames, pose_points)
    if "left_hand_2d" not in arrays:
        arrays["left_hand_2d"] = _zeros_like_2d(left_frames, left_points)
    if "right_hand_2d" not in arrays:
        arrays["right_hand_2d"] = _zeros_like_2d(right_frames, right_points)

    for key in ALL_KEYS:
        arrays[key] = np.asarray(arrays[key], dtype=np.float32)

    return arrays


def _load_npz(path: Path) -> dict[str, np.ndarray]:
    with np.load(path, allow_pickle=False) as loaded:
        return {key: loaded[key] for key in loaded.files}


def _build_clip_asset(entry: dict[str, Any], subdir: str, asset_root: Path, source: str) -> ClipAsset:
    relative_path = Path(entry["path"])
    clip_path = asset_root / subdir / relative_path
    arrays = _coerce_arrays(_load_npz(clip_path))
    meta = dict(entry.get("meta", {}))
    if source == "word":
        boundary_meta = _word_boundaries_for(str(asset_root)).get(str(entry["id"]))
        if boundary_meta:
            meta.update(boundary_meta)
    return ClipAsset(
        id=str(entry["id"]),
        label=str(entry.get("label", entry["id"])),
        fps=int(entry["fps"]),
        source=source,  # type: ignore[arg-type]
        path=clip_path,
        arrays=arrays,
        meta=meta or None,
    )


def load_word_clip(asset_root: Path, word_id: str) -> ClipAsset:
    manifest = _manifest_for(str(asset_root), "words")
    indexed = _index_clips(manifest)
    if word_id not in indexed:
        raise FileNotFoundError(f"Word clip '{word_id}' not found in words/manifest.json")
    return _build_clip_asset(indexed[word_id], "words", asset_root, "word")


def load_phrase_clip(asset_root: Path, phrase_id: str) -> ClipAsset:
    manifest = _manifest_for(str(asset_root), "phrases")
    indexed = _index_clips(manifest)
    if phrase_id not in indexed:
        raise FileNotFoundError(f"Phrase clip '{phrase_id}' not found in phrases/manifest.json")
    return _build_clip_asset(indexed[phrase_id], "phrases", asset_root, "phrase")


def load_prebuilt_transition(asset_root: Path, prev_label: str, next_label: str) -> ClipAsset | None:
    manifest = _manifest_for(str(asset_root), "transitions")
    indexed = _index_transitions(manifest)
    entry = indexed.get((prev_label, next_label))
    if entry is None:
        return None
    return _build_clip_asset(entry, "transitions", asset_root, "transition")
