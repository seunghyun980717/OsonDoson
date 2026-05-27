"""Transition selection from disk assets plus process-local LRU cache."""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

from .clip_loader import load_prebuilt_transition
from .schemas import ClipAsset


class TransitionSelector:
    """Select prebuilt transitions and store generated ones in an LRU cache."""

    def __init__(self, max_entries: int = 32) -> None:
        self.max_entries = max_entries
        self._lru: OrderedDict[tuple[str, str, int, str, int | None], ClipAsset] = OrderedDict()

    def get(
        self,
        asset_root: Path,
        prev_label: str,
        next_label: str,
        target_fps: int,
        transition_method: str = "smoothstep",
        transition_frames: int | None = None,
    ) -> tuple[ClipAsset | None, str]:
        key = (prev_label, next_label, target_fps, transition_method, transition_frames)
        if key in self._lru:
            clip = self._lru.pop(key)
            self._lru[key] = clip
            return clip, "memory"

        if transition_method != "smoothstep" or transition_frames is not None:
            return None, "miss"

        disk_clip = load_prebuilt_transition(asset_root, prev_label, next_label)
        if disk_clip is None:
            return None, "miss"
        if disk_clip.fps != target_fps:
            return None, "miss"
        return disk_clip, "disk"

    def put_generated(
        self,
        prev_label: str,
        next_label: str,
        target_fps: int,
        clip: ClipAsset,
        transition_method: str = "smoothstep",
        transition_frames: int | None = None,
    ) -> None:
        key = (prev_label, next_label, target_fps, transition_method, transition_frames)
        if key in self._lru:
            self._lru.pop(key)
        self._lru[key] = clip
        while len(self._lru) > self.max_entries:
            self._lru.popitem(last=False)

    @property
    def size(self) -> int:
        return len(self._lru)
