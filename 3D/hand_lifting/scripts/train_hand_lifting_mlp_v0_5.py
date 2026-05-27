#!/usr/bin/env python3
"""Train the v0.5 frame-wise MLP for 2D-to-depth hand lifting.

This keeps the v0 171-dim feature input and expands the output to 46 arm+hand
root-relative z targets. It remains frame-wise MLP only; temporal modeling is
left for the TCN stage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import torch
from torch import nn
from torch.utils.data import DataLoader, IterableDataset, get_worker_info

try:
    from tqdm.auto import tqdm
except Exception:
    tqdm = None


HAND_ORDER = ("left", "right")
ARM_TARGETS = (
    ("left", "shoulder", "left_shoulder"),
    ("right", "shoulder", "right_shoulder"),
    ("left", "elbow", "left_elbow"),
    ("right", "elbow", "right_elbow"),
    ("left", "wrist", "left_wrist"),
    ("right", "wrist", "right_wrist"),
)
HAND_PALM_JOINTS = (5, 9, 13, 17)
HAND_FINGER_JOINTS = (1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20)
TARGET_SPECS: tuple[dict[str, Any], ...] = tuple(
    {"side": side, "group": group, "kind": "arm", "label": label}
    for side, group, label in ARM_TARGETS
) + tuple(
    {
        "side": side,
        "group": "palm" if joint in HAND_PALM_JOINTS else "finger",
        "kind": "hand",
        "joint": joint,
    }
    for side in HAND_ORDER
    for joint in range(1, 21)
)
GROUP_INDICES = {
    group: tuple(index for index, spec in enumerate(TARGET_SPECS) if spec["group"] == group)
    for group in ("shoulder", "elbow", "wrist", "palm", "finger")
}
SIDE_INDICES = {
    side: tuple(index for index, spec in enumerate(TARGET_SPECS) if spec["side"] == side)
    for side in HAND_ORDER
}
TARGET_INDEX_BY_NAME = {
    spec["label"] if spec["kind"] == "arm" else f"{spec['side']}_hand_{spec['joint']}": index
    for index, spec in enumerate(TARGET_SPECS)
}
HAND_BONES = (
    (1, 2),
    (2, 3),
    (3, 4),
    (5, 6),
    (6, 7),
    (7, 8),
    (9, 10),
    (10, 11),
    (11, 12),
    (13, 14),
    (14, 15),
    (15, 16),
    (17, 18),
    (18, 19),
    (19, 20),
)
BONE_Z_PAIRS = tuple(
    (TARGET_INDEX_BY_NAME[f"{side}_hand_{a}"], TARGET_INDEX_BY_NAME[f"{side}_hand_{b}"])
    for side in HAND_ORDER
    for a, b in HAND_BONES
)
ARM_Z_PAIRS = (
    (TARGET_INDEX_BY_NAME["left_shoulder"], TARGET_INDEX_BY_NAME["left_elbow"]),
    (TARGET_INDEX_BY_NAME["left_elbow"], TARGET_INDEX_BY_NAME["left_wrist"]),
    (TARGET_INDEX_BY_NAME["right_shoulder"], TARGET_INDEX_BY_NAME["right_elbow"]),
    (TARGET_INDEX_BY_NAME["right_elbow"], TARGET_INDEX_BY_NAME["right_wrist"]),
)
INPUT_LAYOUT = {
    "pose_2d_norm": {"points": 11, "components": ("x", "y", "confidence"), "dims": 33},
    "left_hand_2d_norm": {"points": 21, "components": ("x", "y", "confidence"), "dims": 63},
    "right_hand_2d_norm": {"points": 21, "components": ("x", "y", "confidence"), "dims": 63},
    "derived_order": (
        "left_palm_center_2d_norm",
        "right_palm_center_2d_norm",
        "left_hand_size_2d",
        "right_hand_size_2d",
        "left_arm_extension_2d",
        "right_arm_extension_2d",
        "left_torso_overlap_score",
        "right_torso_overlap_score",
    ),
    "input_dim": 171,
}
TARGET_LAYOUT = {
    "hand_order": HAND_ORDER,
    "output_dim": 46,
    "coordinate_space": "root_relative_z_normalized_by_3d_shoulder_width",
    "target_specs": TARGET_SPECS,
    "groups": GROUP_INDICES,
    "side_indices": SIDE_INDICES,
    "hand_joint_zero_policy": "hand joint 0 shares the corresponding pose wrist z and is not separately predicted",
}
DEFAULT_SPLIT_ROOT = Path("D:/ssafy/3_자율/artifacts/hand_lifting/05_split/mixed")
DEFAULT_SPLIT_ROOT = Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting_v0_5/05_split/mixed")
DEFAULT_TENSOR_CACHE_ROOT = Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting_v0_5/06_tensor_cache/mixed")
DEFAULT_REPO_HAND_LIFTING_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = DEFAULT_REPO_HAND_LIFTING_ROOT / "runs" / "v0_5_mlp"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-dir", type=Path, default=DEFAULT_SPLIT_ROOT / "train")
    parser.add_argument("--val-dir", type=Path, default=DEFAULT_SPLIT_ROOT / "val")
    parser.add_argument("--test-dir", type=Path, default=DEFAULT_SPLIT_ROOT / "test")
    parser.add_argument(
        "--dataset-format",
        choices=("jsonl", "tensor"),
        default="jsonl",
        help="Input format for training. Use 'tensor' after building the tensor cache.",
    )
    parser.add_argument("--tensor-cache-root", type=Path, default=DEFAULT_TENSOR_CACHE_ROOT)
    parser.add_argument(
        "--split-manifest",
        type=Path,
        default=DEFAULT_SPLIT_ROOT.parent / "hand_lifting_split_mixed_summary.json",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--batch-size", default="auto", help="'auto' or an integer. Default: auto.")
    parser.add_argument(
        "--auto-batch-candidates",
        default="4096,8192,16384,32768",
        help="Comma-separated batch candidates. Largest successful candidate is used.",
    )
    parser.add_argument("--target-vram-ratio", type=float, default=0.85)
    parser.add_argument("--max-epochs", type=int, default=50)
    parser.add_argument("--early-stopping-patience", type=int, default=6)
    parser.add_argument("--early-stopping-min-delta", type=float, default=1e-4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--hidden-dims", default="512,512,256,128")
    parser.add_argument("--bone-loss-weight", type=float, default=0.05)
    parser.add_argument("--elbow-angle-loss-weight", type=float, default=0.02)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto", choices=("auto", "cuda", "cpu"))
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--prefetch-factor", type=int, default=4)
    persistent_group = parser.add_mutually_exclusive_group()
    persistent_group.add_argument("--persistent-workers", dest="persistent_workers", action="store_true")
    persistent_group.add_argument("--no-persistent-workers", dest="persistent_workers", action="store_false")
    parser.set_defaults(persistent_workers=None)
    parser.add_argument("--shuffle-buffer-size", type=int, default=65536)
    parser.add_argument("--max-train-rows", type=int)
    parser.add_argument("--max-val-rows", type=int)
    parser.add_argument("--max-test-rows", type=int)
    parser.add_argument("--log-every", type=int, default=25)
    progress_group = parser.add_mutually_exclusive_group()
    progress_group.add_argument("--progress", dest="progress", action="store_true")
    progress_group.add_argument("--no-progress", dest="progress", action="store_false")
    parser.set_defaults(progress=True)
    parser.add_argument("--no-test", action="store_true", help="Skip final best-checkpoint test evaluation.")
    return parser.parse_args()


def parse_int_list(value: str) -> list[int]:
    return [int(item.strip()) for item in value.split(",") if item.strip()]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit(repo_root: Path) -> str | None:
    try:
        import subprocess

        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip()
    except Exception:
        return None


def list_jsonl_files(path: Path) -> list[Path]:
    if not path.exists():
        raise FileNotFoundError(f"Split directory does not exist: {path}")
    files = sorted(path.glob("*.jsonl"))
    if not files:
        raise FileNotFoundError(f"No JSONL shards found in: {path}")
    return files


def list_tensor_files(path: Path) -> list[Path]:
    if not path.exists():
        raise FileNotFoundError(f"Tensor cache split directory does not exist: {path}")
    files = sorted(path.glob("*.pt"))
    if not files:
        raise FileNotFoundError(f"No tensor cache shards found in: {path}")
    return files


def flatten_points(points: list[Any]) -> list[float]:
    values: list[float] = []
    for point in points:
        values.extend(float(component) for component in point)
    return values


def flatten_derived(derived: dict[str, Any]) -> list[float]:
    values: list[float] = []
    for key in INPUT_LAYOUT["derived_order"]:
        value = derived.get(key)
        if isinstance(value, list):
            values.extend(float(component) for component in value)
        else:
            values.append(float(value or 0.0))
    return values


def is_finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def row_to_sample(row: dict[str, Any]) -> dict[str, torch.Tensor]:
    inputs = row["inputs"]
    x_values = (
        flatten_points(inputs["pose_2d_norm"])
        + flatten_points(inputs["left_hand_2d_norm"])
        + flatten_points(inputs["right_hand_2d_norm"])
        + flatten_derived(inputs["derived"])
    )
    if len(x_values) != INPUT_LAYOUT["input_dim"]:
        raise ValueError(f"Unexpected input dim: {len(x_values)}")

    target = torch.zeros((TARGET_LAYOUT["output_dim"],), dtype=torch.float32)
    mask = torch.zeros((TARGET_LAYOUT["output_dim"],), dtype=torch.bool)
    labels = row["labels"]
    masks = row["masks"]
    pose_root_z = labels.get("pose_root_z") or {}
    hand_wrist_root_z = labels.get("hand_wrist_root_z") or {}
    hand_wrist_relative_z = labels.get("hand_wrist_relative_z") or {}

    for target_index, spec in enumerate(TARGET_SPECS):
        hand = spec["side"]
        hand_mask = masks.get(hand) or {}
        if spec["kind"] == "arm":
            target_value = pose_root_z.get(spec["label"])
        else:
            wrist_root = hand_wrist_root_z.get(hand)
            relative_z = hand_wrist_relative_z.get(hand) or []
            joint_index = int(spec["joint"])
            rel = relative_z[joint_index] if joint_index < len(relative_z) else None
            target_value = float(wrist_root) + float(rel) if is_finite(wrist_root) and is_finite(rel) else None

        if not is_finite(target_value):
            continue
        target[target_index] = float(target_value)
        if spec["group"] in ("shoulder", "elbow", "wrist"):
            use_target = bool(hand_mask.get("use_wrist_depth"))
        elif spec["group"] == "palm":
            use_target = bool(hand_mask.get("use_palm_depth"))
        else:
            use_target = bool(hand_mask.get("use_finger_depth"))
        mask[target_index] = use_target

    kind = 0 if row.get("dataset_kind") == "word" else 1
    return {
        "x": torch.tensor(x_values, dtype=torch.float32),
        "target": target,
        "mask": mask,
        "kind": torch.tensor(kind, dtype=torch.long),
    }


class JsonlHandLiftingDataset(IterableDataset):
    def __init__(
        self,
        files: list[Path],
        shuffle: bool,
        seed: int,
        shuffle_buffer_size: int,
        max_rows: int | None,
    ):
        super().__init__()
        self.files = files
        self.shuffle = shuffle
        self.seed = seed
        self.shuffle_buffer_size = shuffle_buffer_size
        self.max_rows = max_rows
        self.epoch = 0
        self._worker_iteration = 0

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def _effective_epoch(self) -> int:
        if get_worker_info() is None:
            return self.epoch
        self._worker_iteration += 1
        return self.epoch + self._worker_iteration

    def _worker_files(self) -> list[Path]:
        worker = get_worker_info()
        if worker is None:
            return self.files
        return [path for index, path in enumerate(self.files) if index % worker.num_workers == worker.id]

    def _iter_rows(self, effective_epoch: int) -> Iterable[dict[str, Any]]:
        files = self._worker_files()
        rng = random.Random(self.seed + effective_epoch)
        if self.shuffle:
            files = files[:]
            rng.shuffle(files)
        emitted = 0
        for path in files:
            with path.open(encoding="utf-8-sig") as fp:
                for line in fp:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    yield json.loads(stripped)
                    emitted += 1
                    if self.max_rows is not None and emitted >= self.max_rows:
                        return

    def __iter__(self):
        effective_epoch = self._effective_epoch()
        if not self.shuffle or self.shuffle_buffer_size <= 1:
            for row in self._iter_rows(effective_epoch):
                sample = row_to_sample(row)
                if sample["mask"].any():
                    yield sample
            return

        rng = random.Random(self.seed + effective_epoch)
        buffer: list[dict[str, torch.Tensor]] = []
        for row in self._iter_rows(effective_epoch):
            sample = row_to_sample(row)
            if not sample["mask"].any():
                continue
            buffer.append(sample)
            if len(buffer) >= self.shuffle_buffer_size:
                index = rng.randrange(len(buffer))
                yield buffer.pop(index)
        while buffer:
            index = rng.randrange(len(buffer))
            yield buffer.pop(index)


class TensorShardHandLiftingDataset(IterableDataset):
    def __init__(
        self,
        files: list[Path],
        batch_size: int,
        shuffle: bool,
        seed: int,
        max_rows: int | None,
    ):
        super().__init__()
        self.files = files
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.seed = seed
        self.max_rows = max_rows
        self.epoch = 0
        self._worker_iteration = 0

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def _effective_epoch(self) -> int:
        if get_worker_info() is None:
            return self.epoch
        self._worker_iteration += 1
        return self.epoch + self._worker_iteration

    def _worker_files(self) -> list[Path]:
        worker = get_worker_info()
        if worker is None:
            return self.files
        return [path for index, path in enumerate(self.files) if index % worker.num_workers == worker.id]

    def __iter__(self):
        files = self._worker_files()
        effective_epoch = self._effective_epoch()
        rng = random.Random(self.seed + effective_epoch)
        if self.shuffle:
            files = files[:]
            rng.shuffle(files)

        emitted = 0
        for path in files:
            payload = torch.load(path, map_location="cpu", weights_only=False)
            x = payload["x"].float()
            target = payload["target"].float()
            mask = payload["mask"].bool()
            kind = payload["kind"].long()
            row_count = int(x.shape[0])
            if row_count == 0:
                continue
            if x.shape[1] != INPUT_LAYOUT["input_dim"]:
                raise ValueError(f"Unexpected input dim in {path}: {x.shape[1]}")
            if target.shape[1] != TARGET_LAYOUT["output_dim"] or mask.shape[1] != TARGET_LAYOUT["output_dim"]:
                raise ValueError(f"Unexpected target/mask dim in {path}: {target.shape[1]} / {mask.shape[1]}")

            indices = None
            if self.shuffle:
                generator = torch.Generator()
                path_seed = int(hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:8], 16)
                generator.manual_seed(self.seed + effective_epoch + path_seed)
                indices = torch.randperm(row_count, generator=generator)

            start = 0
            while start < row_count:
                if self.max_rows is not None and emitted >= self.max_rows:
                    return
                stop = min(start + self.batch_size, row_count)
                if self.max_rows is not None:
                    stop = min(stop, start + (self.max_rows - emitted))

                if indices is None:
                    batch = {
                        "x": x[start:stop],
                        "target": target[start:stop],
                        "mask": mask[start:stop],
                        "kind": kind[start:stop],
                    }
                else:
                    selected = indices[start:stop]
                    batch = {
                        "x": x.index_select(0, selected),
                        "target": target.index_select(0, selected),
                        "mask": mask.index_select(0, selected),
                        "kind": kind.index_select(0, selected),
                    }

                valid_rows = batch["mask"].any(dim=1)
                if valid_rows.any():
                    if not bool(valid_rows.all()):
                        batch = {key: value[valid_rows] for key, value in batch.items()}
                    emitted += int(batch["x"].shape[0])
                    yield batch
                start = stop


class HandLiftMLP(nn.Module):
    def __init__(self, input_dim: int, hidden_dims: list[int], output_dim: int, dropout: float):
        super().__init__()
        layers: list[nn.Module] = []
        prev_dim = input_dim
        for hidden_dim in hidden_dims:
            layers.append(nn.Linear(prev_dim, hidden_dim))
            layers.append(nn.LayerNorm(hidden_dim))
            layers.append(nn.GELU())
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = hidden_dim
        layers.append(nn.Linear(prev_dim, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def group_mask(mask: torch.Tensor, group: str) -> torch.Tensor:
    indices = torch.tensor(GROUP_INDICES[group], device=mask.device)
    return mask.index_select(dim=1, index=indices)


def group_values(values: torch.Tensor, group: str) -> torch.Tensor:
    indices = torch.tensor(GROUP_INDICES[group], device=values.device)
    return values.index_select(dim=1, index=indices)


def pair_delta_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, pairs: tuple[tuple[int, int], ...]) -> torch.Tensor | None:
    losses: list[torch.Tensor] = []
    for a, b in pairs:
        pair_mask = mask[:, a] & mask[:, b] & torch.isfinite(target[:, a]) & torch.isfinite(target[:, b])
        if pair_mask.any():
            pred_delta = pred[pair_mask, a] - pred[pair_mask, b]
            target_delta = target[pair_mask, a] - target[pair_mask, b]
            losses.append((pred_delta - target_delta).abs().mean())
    return torch.stack(losses).mean() if losses else None


def pose_xy(x: torch.Tensor, pose_input_position: int) -> torch.Tensor:
    start = pose_input_position * 3
    return x[:, start : start + 2]


def elbow_cosine(shoulder: torch.Tensor, elbow: torch.Tensor, wrist: torch.Tensor) -> torch.Tensor:
    upper = shoulder - elbow
    lower = wrist - elbow
    upper_norm = torch.linalg.norm(upper, dim=1).clamp_min(1e-8)
    lower_norm = torch.linalg.norm(lower, dim=1).clamp_min(1e-8)
    cosine = (upper * lower).sum(dim=1) / (upper_norm * lower_norm)
    return cosine.clamp(-0.999, 0.999)


def elbow_angle_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, x: torch.Tensor | None) -> torch.Tensor | None:
    if x is None:
        return None
    losses: list[torch.Tensor] = []
    pose_positions = {
        "right": {"shoulder": 2, "elbow": 3, "wrist": 4},
        "left": {"shoulder": 5, "elbow": 6, "wrist": 7},
    }
    for side in HAND_ORDER:
        shoulder = TARGET_INDEX_BY_NAME[f"{side}_shoulder"]
        elbow = TARGET_INDEX_BY_NAME[f"{side}_elbow"]
        wrist = TARGET_INDEX_BY_NAME[f"{side}_wrist"]
        active = (
            mask[:, shoulder]
            & mask[:, elbow]
            & mask[:, wrist]
            & torch.isfinite(target[:, shoulder])
            & torch.isfinite(target[:, elbow])
            & torch.isfinite(target[:, wrist])
        )
        if active.any():
            positions = pose_positions[side]
            shoulder_xy = pose_xy(x, positions["shoulder"])[active]
            elbow_xy = pose_xy(x, positions["elbow"])[active]
            wrist_xy = pose_xy(x, positions["wrist"])[active]
            pred_shoulder = torch.cat([shoulder_xy, pred[active, shoulder].unsqueeze(1)], dim=1)
            pred_elbow = torch.cat([elbow_xy, pred[active, elbow].unsqueeze(1)], dim=1)
            pred_wrist = torch.cat([wrist_xy, pred[active, wrist].unsqueeze(1)], dim=1)
            target_shoulder = torch.cat([shoulder_xy, target[active, shoulder].unsqueeze(1)], dim=1)
            target_elbow = torch.cat([elbow_xy, target[active, elbow].unsqueeze(1)], dim=1)
            target_wrist = torch.cat([wrist_xy, target[active, wrist].unsqueeze(1)], dim=1)
            pred_cosine = elbow_cosine(pred_shoulder, pred_elbow, pred_wrist)
            target_cosine = elbow_cosine(target_shoulder, target_elbow, target_wrist).detach()
            losses.append(torch.nn.functional.smooth_l1_loss(pred_cosine, target_cosine, beta=0.05))
    return torch.stack(losses).mean() if losses else None


def masked_l1_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
    bone_loss_weight: float = 0.05,
    elbow_angle_loss_weight: float = 0.02,
    x: torch.Tensor | None = None,
) -> tuple[torch.Tensor, dict[str, float]]:
    losses: list[torch.Tensor] = []
    details: dict[str, float] = {}
    abs_error = (pred - target).abs()
    finite = torch.isfinite(target)
    active_mask = mask & finite
    for group in ("shoulder", "elbow", "wrist", "palm", "finger"):
        selected_error = group_values(abs_error, group)
        selected_mask = group_mask(active_mask, group)
        count = selected_mask.sum()
        if count.item() > 0:
            group_loss = selected_error[selected_mask].mean()
            losses.append(group_loss)
            details[f"loss_{group}"] = float(group_loss.detach().cpu())
            details[f"count_{group}"] = int(count.detach().cpu())
        else:
            details[f"loss_{group}"] = math.nan
            details[f"count_{group}"] = 0
    if not losses:
        return pred.sum() * 0.0, details
    total_loss = torch.stack(losses).mean()
    bone_loss = pair_delta_loss(pred, target, active_mask, BONE_Z_PAIRS + ARM_Z_PAIRS)
    if bone_loss is not None and bone_loss_weight > 0:
        total_loss = total_loss + bone_loss * bone_loss_weight
        details["loss_bone_z_delta"] = float(bone_loss.detach().cpu())
    else:
        details["loss_bone_z_delta"] = math.nan
    elbow_loss = elbow_angle_loss(pred, target, active_mask, x)
    if elbow_loss is not None and elbow_angle_loss_weight > 0:
        total_loss = total_loss + elbow_loss * elbow_angle_loss_weight
        details["loss_elbow_angle"] = float(elbow_loss.detach().cpu())
    else:
        details["loss_elbow_angle"] = math.nan
    return total_loss, details


class MetricAccumulator:
    def __init__(self):
        self.abs_errors: list[torch.Tensor] = []
        self.micro_sum = 0.0
        self.micro_sq_sum = 0.0
        self.micro_count = 0
        self.group_sum: dict[str, float] = defaultdict(float)
        self.group_sq_sum: dict[str, float] = defaultdict(float)
        self.group_count: dict[str, int] = defaultdict(int)
        self.kind_sum: dict[str, float] = defaultdict(float)
        self.kind_count: dict[str, int] = defaultdict(int)

    def update(self, pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, kind: torch.Tensor) -> None:
        with torch.no_grad():
            abs_error = (pred - target).abs()
            finite = torch.isfinite(target)
            active_mask = mask & finite
            if active_mask.any():
                active_errors = abs_error[active_mask].detach().cpu()
                self.abs_errors.append(active_errors)
                self.micro_sum += float(active_errors.sum())
                self.micro_sq_sum += float((active_errors**2).sum())
                self.micro_count += int(active_errors.numel())

            for hand in HAND_ORDER:
                for group in ("shoulder", "elbow", "wrist", "palm", "finger"):
                    indices = [index for index, spec in enumerate(TARGET_SPECS) if spec["side"] == hand and spec["group"] == group]
                    if not indices:
                        continue
                    selected_error = abs_error[:, indices]
                    selected_mask = active_mask[:, indices]
                    if selected_mask.any():
                        values = selected_error[selected_mask].detach().cpu()
                        key = f"{hand}.{group}"
                        self.group_sum[key] += float(values.sum())
                        self.group_sq_sum[key] += float((values**2).sum())
                        self.group_count[key] += int(values.numel())

            for kind_value, kind_name in ((0, "word"), (1, "sen")):
                rows = kind == kind_value
                if rows.any():
                    selected_error = abs_error[rows]
                    selected_mask = active_mask[rows]
                    if selected_mask.any():
                        values = selected_error[selected_mask].detach().cpu()
                        self.kind_sum[kind_name] += float(values.sum())
                        self.kind_count[kind_name] += int(values.numel())

    def result(self) -> dict[str, Any]:
        by_target: dict[str, Any] = {}
        group_maes: dict[str, list[float]] = {"shoulder": [], "elbow": [], "wrist": [], "palm": [], "finger": []}
        for key in sorted(self.group_count):
            count = self.group_count[key]
            mae = self.group_sum[key] / count if count else None
            rmse = math.sqrt(self.group_sq_sum[key] / count) if count else None
            by_target[key] = {"mae_norm": mae, "rmse_norm": rmse, "count": count}
            group = key.split(".")[1]
            if mae is not None:
                group_maes[group].append(mae)

        macro_parts = []
        for group in ("shoulder", "elbow", "wrist", "palm", "finger"):
            if group_maes[group]:
                macro_parts.append(sum(group_maes[group]) / len(group_maes[group]))
        all_abs = torch.cat(self.abs_errors) if self.abs_errors else torch.empty(0)
        percentiles = {}
        if all_abs.numel():
            q = torch.quantile(all_abs, torch.tensor([0.5, 0.9, 0.95], dtype=torch.float32))
            percentiles = {"p50_abs_error": float(q[0]), "p90_abs_error": float(q[1]), "p95_abs_error": float(q[2])}
        else:
            percentiles = {"p50_abs_error": None, "p90_abs_error": None, "p95_abs_error": None}

        by_dataset_kind = {}
        for kind_name in ("word", "sen"):
            count = self.kind_count.get(kind_name, 0)
            by_dataset_kind[kind_name] = {
                "mae_norm": self.kind_sum[kind_name] / count if count else None,
                "count": count,
            }

        return {
            "overall": {
                "mae_macro_norm": sum(macro_parts) / len(macro_parts) if macro_parts else None,
                "mae_micro_norm": self.micro_sum / self.micro_count if self.micro_count else None,
                "rmse_micro_norm": math.sqrt(self.micro_sq_sum / self.micro_count) if self.micro_count else None,
                "valid_target_count": self.micro_count,
                **percentiles,
            },
            "by_target": by_target,
            "by_dataset_kind": by_dataset_kind,
        }


def loader_kwargs(num_workers: int, prefetch_factor: int, persistent_workers: bool | None) -> dict[str, Any]:
    pin_memory = torch.cuda.is_available()
    kwargs: dict[str, Any] = {"num_workers": num_workers, "pin_memory": pin_memory}
    if num_workers > 0:
        kwargs["persistent_workers"] = bool(persistent_workers)
        kwargs["prefetch_factor"] = prefetch_factor
    return kwargs


def make_jsonl_loader(
    files: list[Path],
    batch_size: int,
    shuffle: bool,
    seed: int,
    shuffle_buffer_size: int,
    max_rows: int | None,
    num_workers: int,
    prefetch_factor: int,
    persistent_workers: bool | None,
) -> tuple[JsonlHandLiftingDataset, DataLoader]:
    if max_rows is not None and num_workers > 0:
        num_workers = 0
    dataset = JsonlHandLiftingDataset(
        files=files,
        shuffle=shuffle,
        seed=seed,
        shuffle_buffer_size=shuffle_buffer_size,
        max_rows=max_rows,
    )
    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        **loader_kwargs(num_workers, prefetch_factor, persistent_workers),
    )
    return dataset, loader


def make_tensor_loader(
    files: list[Path],
    batch_size: int,
    shuffle: bool,
    seed: int,
    max_rows: int | None,
    num_workers: int,
    prefetch_factor: int,
    persistent_workers: bool | None,
) -> tuple[TensorShardHandLiftingDataset, DataLoader]:
    if max_rows is not None and num_workers > 0:
        num_workers = 0
    dataset = TensorShardHandLiftingDataset(
        files=files,
        batch_size=batch_size,
        shuffle=shuffle,
        seed=seed,
        max_rows=max_rows,
    )
    loader = DataLoader(
        dataset,
        batch_size=None,
        **loader_kwargs(num_workers, prefetch_factor, persistent_workers),
    )
    return dataset, loader


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but torch.cuda.is_available() is false.")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def choose_batch_size(
    requested: str,
    candidates: list[int],
    model: nn.Module,
    device: torch.device,
    target_vram_ratio: float,
    input_dim: int,
    output_dim: int,
) -> tuple[int, dict[str, Any]]:
    if requested != "auto":
        return int(requested), {"mode": "manual", "selected": int(requested)}
    if device.type != "cuda":
        return min(candidates), {"mode": "auto_cpu", "selected": min(candidates), "candidates": candidates}

    attempts = []
    for candidate in sorted(candidates, reverse=True):
        try:
            torch.cuda.empty_cache()
            before_free, total = torch.cuda.mem_get_info()
            x = torch.randn(candidate, input_dim, device=device)
            target = torch.randn(candidate, output_dim, device=device)
            mask = torch.ones(candidate, output_dim, dtype=torch.bool, device=device)
            pred = model(x)
            loss, _ = masked_l1_loss(pred, target, mask)
            loss.backward()
            after_free, _ = torch.cuda.mem_get_info()
            used = max(0, before_free - after_free)
            ratio = used / total if total else None
            model.zero_grad(set_to_none=True)
            del x, target, mask, pred, loss
            torch.cuda.empty_cache()
            attempts.append({"batch_size": candidate, "status": "ok", "estimated_vram_ratio": ratio})
            return candidate, {
                "mode": "auto_cuda",
                "selected": candidate,
                "candidates": candidates,
                "target_vram_ratio": target_vram_ratio,
                "attempts": attempts,
            }
        except RuntimeError as exc:
            if "out of memory" not in str(exc).lower():
                raise
            attempts.append({"batch_size": candidate, "status": "oom"})
            model.zero_grad(set_to_none=True)
            torch.cuda.empty_cache()
    selected = min(candidates)
    return selected, {
        "mode": "auto_cuda_fallback",
        "selected": selected,
        "candidates": candidates,
        "target_vram_ratio": target_vram_ratio,
        "attempts": attempts,
    }


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    split_name: str,
    total_steps: int | None,
    progress: bool,
    max_batches: int | None = None,
) -> dict[str, Any]:
    model.eval()
    metrics = MetricAccumulator()
    with torch.no_grad():
        iterator = progress_iter(loader, total_steps, f"{split_name}", progress)
        for batch_index, batch in enumerate(iterator, start=1):
            x = batch["x"].to(device, non_blocking=True)
            target = batch["target"].to(device, non_blocking=True)
            mask = batch["mask"].to(device, non_blocking=True)
            kind = batch["kind"]
            pred = model(x)
            metrics.update(pred.cpu(), target.cpu(), mask.cpu(), kind.cpu())
            if max_batches is not None and batch_index >= max_batches:
                break
    return metrics.result()


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    gradient_clip: float,
    log_every: int,
    epoch: int,
    total_steps: int | None,
    progress: bool,
    bone_loss_weight: float,
    elbow_angle_loss_weight: float,
) -> dict[str, Any]:
    model.train()
    total_loss = 0.0
    steps = 0
    started = time.time()
    iterator = progress_iter(loader, total_steps, f"train epoch {epoch}", progress)
    for batch in iterator:
        x = batch["x"].to(device, non_blocking=True)
        target = batch["target"].to(device, non_blocking=True)
        mask = batch["mask"].to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        pred = model(x)
        loss, _ = masked_l1_loss(pred, target, mask, bone_loss_weight, elbow_angle_loss_weight, x)
        loss.backward()
        if gradient_clip > 0:
            torch.nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
        optimizer.step()
        total_loss += float(loss.detach().cpu())
        steps += 1
        if progress and hasattr(iterator, "set_postfix"):
            iterator.set_postfix(loss=f"{total_loss / steps:.6f}")
        if log_every and steps % log_every == 0:
            progress_write(f"epoch={epoch} step={steps} train_loss={total_loss / steps:.6f}", progress)
    elapsed = time.time() - started
    return {"loss": total_loss / max(steps, 1), "steps": steps, "elapsed_sec": elapsed}


def save_checkpoint(
    path: Path,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler.ReduceLROnPlateau,
    epoch: int,
    config: dict[str, Any],
    metrics: dict[str, Any],
    best_metric: float,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "scheduler_state_dict": scheduler.state_dict(),
            "epoch": epoch,
            "metrics": metrics,
            "best_metric": best_metric,
            "config": config,
            "input_layout": INPUT_LAYOUT,
            "target_layout": TARGET_LAYOUT,
        },
        path,
    )


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def progress_iter(iterable: Iterable[Any], total: int | None, desc: str, enabled: bool) -> Iterable[Any]:
    if enabled and tqdm is not None:
        return tqdm(iterable, total=total, desc=desc, dynamic_ncols=True, leave=False)
    return iterable


def progress_write(message: str, enabled: bool) -> None:
    if enabled and tqdm is not None:
        tqdm.write(message)
    else:
        print(message, flush=True)


def ceil_div(value: int, divisor: int) -> int:
    return (value + divisor - 1) // divisor


def estimate_steps_from_row_counts(row_counts: list[int], batch_size: int, max_rows: int | None) -> int | None:
    if not row_counts:
        return None
    remaining = max_rows
    steps = 0
    for row_count in row_counts:
        use_rows = row_count
        if remaining is not None:
            if remaining <= 0:
                break
            use_rows = min(use_rows, remaining)
            remaining -= use_rows
        if use_rows > 0:
            steps += ceil_div(use_rows, batch_size)
    return steps


def estimate_steps(
    dataset_format: str,
    split: str,
    batch_size: int,
    max_rows: int | None,
    split_manifest: Path,
    tensor_cache_root: Path,
) -> int | None:
    if dataset_format == "tensor":
        summary_path = tensor_cache_root / "hand_lifting_tensor_cache_mixed_summary.json"
        if summary_path.exists():
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            shard_rows = [
                int(item["row_count"])
                for item in summary.get("shards", [])
                if item.get("split") == split
            ]
            if shard_rows:
                return estimate_steps_from_row_counts(shard_rows, batch_size, max_rows)
            split_summary = summary.get("splits", {}).get(split)
            if split_summary:
                return estimate_steps_from_row_counts([int(split_summary["row_count"])], batch_size, max_rows)

    if split_manifest.exists():
        summary = json.loads(split_manifest.read_text(encoding="utf-8"))
        split_summary = summary.get("summary", {}).get("splits", {}).get(split)
        if split_summary:
            return estimate_steps_from_row_counts([int(split_summary["row_count"])], batch_size, max_rows)
    return None


def build_config(args: argparse.Namespace, selected_batch_size: int, batch_selection: dict[str, Any], device: torch.device) -> dict[str, Any]:
    repo_root = DEFAULT_REPO_HAND_LIFTING_ROOT.parents[1]
    device_info = {
        "device": str(device),
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda,
        "cuda_device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    return {
        "created_at": now_iso(),
        "script": str(Path(__file__).resolve()),
        "git_commit": git_commit(repo_root),
        "input": {
            "dataset_format": args.dataset_format,
            "train_dir": str(args.train_dir),
            "val_dir": str(args.val_dir),
            "test_dir": str(args.test_dir),
            "tensor_cache_root": str(args.tensor_cache_root),
            "split_manifest": str(args.split_manifest),
            "split_manifest_sha256": sha256_file(args.split_manifest),
        },
        "output_dir": str(args.output_dir),
        "model": {
            "model_class": "HandLiftMLP",
            "input_dim": INPUT_LAYOUT["input_dim"],
            "hidden_dims": parse_int_list(args.hidden_dims),
            "output_dim": TARGET_LAYOUT["output_dim"],
            "activation": "GELU",
            "normalization": "LayerNorm",
            "dropout": args.dropout,
        },
        "training": {
            "selected_batch_size": selected_batch_size,
            "batch_selection": batch_selection,
            "max_epochs": args.max_epochs,
            "optimizer": "AdamW",
            "lr": args.lr,
            "weight_decay": args.weight_decay,
            "bone_loss_weight": args.bone_loss_weight,
            "elbow_angle_loss_weight": args.elbow_angle_loss_weight,
            "gradient_clip": args.gradient_clip,
            "early_stopping_patience": args.early_stopping_patience,
            "early_stopping_min_delta": args.early_stopping_min_delta,
            "seed": args.seed,
            "num_workers": args.num_workers,
            "prefetch_factor": args.prefetch_factor,
            "persistent_workers": args.persistent_workers,
            "progress": args.progress,
            "shuffle_buffer_size": args.shuffle_buffer_size,
            "max_train_rows": args.max_train_rows,
            "max_val_rows": args.max_val_rows,
            "max_test_rows": args.max_test_rows,
        },
        "device": device_info,
        "input_layout": INPUT_LAYOUT,
        "target_layout": TARGET_LAYOUT,
        "mask_policy": {
            "shoulder": {"indices": list(GROUP_INDICES["shoulder"]), "flag": "use_wrist_depth"},
            "elbow": {"indices": list(GROUP_INDICES["elbow"]), "flag": "use_wrist_depth"},
            "wrist": {"indices": list(GROUP_INDICES["wrist"]), "flag": "use_wrist_depth"},
            "palm": {"indices": list(GROUP_INDICES["palm"]), "flag": "use_palm_depth"},
            "finger": {"indices": list(GROUP_INDICES["finger"]), "flag": "use_finger_depth"},
        },
        "normalization": {
            "input_xy": "(point_xy - shoulder_center_xy_2d) / shoulder_width_2d",
            "target_z": "(joint_z - shoulder_center_z_3d) / shoulder_width_3d",
        },
    }


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = resolve_device(args.device)
    if args.persistent_workers is None:
        args.persistent_workers = args.num_workers > 0

    if args.dataset_format == "tensor":
        train_files = list_tensor_files(args.tensor_cache_root / "train")
        val_files = list_tensor_files(args.tensor_cache_root / "val")
        test_files = list_tensor_files(args.tensor_cache_root / "test")
    else:
        train_files = list_jsonl_files(args.train_dir)
        val_files = list_jsonl_files(args.val_dir)
        test_files = list_jsonl_files(args.test_dir)

    hidden_dims = parse_int_list(args.hidden_dims)
    model = HandLiftMLP(INPUT_LAYOUT["input_dim"], hidden_dims, TARGET_LAYOUT["output_dim"], args.dropout).to(device)
    batch_candidates = parse_int_list(args.auto_batch_candidates)
    selected_batch_size, batch_selection = choose_batch_size(
        args.batch_size,
        batch_candidates,
        model,
        device,
        args.target_vram_ratio,
        INPUT_LAYOUT["input_dim"],
        TARGET_LAYOUT["output_dim"],
    )
    config = build_config(args, selected_batch_size, batch_selection, device)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = args.output_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    train_config_path = args.output_dir / "hand_lifting_v0_5_train_config.json"
    write_json(train_config_path, config)

    if args.dataset_format == "tensor":
        train_dataset, train_loader = make_tensor_loader(
            train_files,
            selected_batch_size,
            shuffle=True,
            seed=args.seed,
            max_rows=args.max_train_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )
        _, val_loader = make_tensor_loader(
            val_files,
            selected_batch_size,
            shuffle=False,
            seed=args.seed,
            max_rows=args.max_val_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )
        _, test_loader = make_tensor_loader(
            test_files,
            selected_batch_size,
            shuffle=False,
            seed=args.seed,
            max_rows=args.max_test_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )
    else:
        train_dataset, train_loader = make_jsonl_loader(
            train_files,
            selected_batch_size,
            shuffle=True,
            seed=args.seed,
            shuffle_buffer_size=args.shuffle_buffer_size,
            max_rows=args.max_train_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )
        _, val_loader = make_jsonl_loader(
            val_files,
            selected_batch_size,
            shuffle=False,
            seed=args.seed,
            shuffle_buffer_size=0,
            max_rows=args.max_val_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )
        _, test_loader = make_jsonl_loader(
            test_files,
            selected_batch_size,
            shuffle=False,
            seed=args.seed,
            shuffle_buffer_size=0,
            max_rows=args.max_test_rows,
            num_workers=args.num_workers,
            prefetch_factor=args.prefetch_factor,
            persistent_workers=args.persistent_workers,
        )

    train_total_steps = estimate_steps(
        args.dataset_format,
        "train",
        selected_batch_size,
        args.max_train_rows,
        args.split_manifest,
        args.tensor_cache_root,
    )
    val_total_steps = estimate_steps(
        args.dataset_format,
        "val",
        selected_batch_size,
        args.max_val_rows,
        args.split_manifest,
        args.tensor_cache_root,
    )
    test_total_steps = estimate_steps(
        args.dataset_format,
        "test",
        selected_batch_size,
        args.max_test_rows,
        args.split_manifest,
        args.tensor_cache_root,
    )

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)

    best_metric = math.inf
    best_epoch = -1
    bad_epochs = 0
    stopped_reason = "max_epochs_reached"
    history = []
    best_path = args.output_dir / "hand_lifting_v0_5_mlp_best.pt"
    last_path = args.output_dir / "hand_lifting_v0_5_mlp_last.pt"
    log_path = logs_dir / "train_log.jsonl"

    print(
        f"device={device} dataset_format={args.dataset_format} batch_size={selected_batch_size} "
        f"train_shards={len(train_files)} num_workers={args.num_workers} "
        f"train_steps={train_total_steps} val_steps={val_total_steps} test_steps={test_total_steps}",
        flush=True,
    )
    with log_path.open("w", encoding="utf-8") as log_fp:
        for epoch in range(1, args.max_epochs + 1):
            train_dataset.set_epoch(epoch)
            train_metrics = train_one_epoch(
                model,
                train_loader,
                optimizer,
                device,
                args.gradient_clip,
                args.log_every,
                epoch,
                train_total_steps,
                args.progress,
                args.bone_loss_weight,
                args.elbow_angle_loss_weight,
            )
            val_metrics = evaluate(model, val_loader, device, "val", val_total_steps, args.progress)
            val_metric = val_metrics["overall"]["mae_macro_norm"]
            if val_metric is None:
                raise RuntimeError("Validation metric is None; no valid validation targets were evaluated.")
            scheduler.step(val_metric)

            improved = val_metric < best_metric - args.early_stopping_min_delta
            if improved:
                best_metric = val_metric
                best_epoch = epoch
                bad_epochs = 0
            else:
                bad_epochs += 1

            epoch_payload = {
                "epoch": epoch,
                "train": train_metrics,
                "val": val_metrics,
                "lr": optimizer.param_groups[0]["lr"],
                "best_epoch": best_epoch,
                "best_val_mae_macro_norm": best_metric,
                "bad_epochs": bad_epochs,
                "improved": improved,
            }
            history.append(epoch_payload)
            log_fp.write(json.dumps(epoch_payload, ensure_ascii=False) + "\n")
            log_fp.flush()

            save_checkpoint(last_path, model, optimizer, scheduler, epoch, config, val_metrics, best_metric)
            if improved:
                save_checkpoint(best_path, model, optimizer, scheduler, epoch, config, val_metrics, best_metric)
            print(
                f"epoch={epoch} train_loss={train_metrics['loss']:.6f} "
                f"val_mae_macro={val_metric:.6f} best={best_metric:.6f} bad_epochs={bad_epochs}",
                flush=True,
            )

            if bad_epochs >= args.early_stopping_patience:
                stopped_reason = "early_stopping_patience_reached"
                break

    val_benchmark = {
        "schema_version": "hand-lifting-benchmark/v1",
        "split": "val",
        "run": {
            "model_id": "hand_lifting_v0_5_mlp",
            "checkpoint": str(best_path),
            "checkpoint_sha256": sha256_file(best_path),
            "created_at": now_iso(),
            "device": str(device),
            "best_epoch": best_epoch,
            "stopped_epoch": history[-1]["epoch"] if history else None,
            "early_stopping_reason": stopped_reason,
        },
        "metrics": history[best_epoch - 1]["val"] if best_epoch > 0 else None,
    }
    write_json(args.output_dir / "hand_lifting_v0_5_benchmark_val.json", val_benchmark)

    test_benchmark = None
    if not args.no_test:
        checkpoint = torch.load(best_path, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model_state_dict"])
        test_metrics = evaluate(model, test_loader, device, "test", test_total_steps, args.progress)
        test_benchmark = {
            "schema_version": "hand-lifting-benchmark/v1",
            "split": "test",
            "run": {
                "model_id": "hand_lifting_v0_5_mlp",
                "checkpoint": str(best_path),
                "checkpoint_sha256": sha256_file(best_path),
                "created_at": now_iso(),
                "device": str(device),
                "best_epoch": best_epoch,
            },
            "metrics": test_metrics,
        }
        write_json(args.output_dir / "hand_lifting_v0_5_benchmark_test.json", test_benchmark)

    profile = {
        "profile_schema_version": "hand-lifting-profile/v1",
        "model_id": "hand_lifting_v0_5_mlp",
        "checkpoint": str(best_path),
        "checkpoint_sha256": sha256_file(best_path),
        "train_config": str(train_config_path),
        "coordinate_space": TARGET_LAYOUT["coordinate_space"],
        "input_layout": INPUT_LAYOUT,
        "target_layout": TARGET_LAYOUT,
        "mask_policy": config["mask_policy"],
        "normalization": config["normalization"],
        "model": config["model"],
        "training_result": {
            "best_epoch": best_epoch,
            "best_val_mae_macro_norm": best_metric,
            "stopped_epoch": history[-1]["epoch"] if history else None,
            "early_stopping_reason": stopped_reason,
            "selected_batch_size": selected_batch_size,
        },
    }
    write_json(args.output_dir / "hand_lifting_v0_5_profile.json", profile)

    final_summary = {
        "best_epoch": best_epoch,
        "best_val_mae_macro_norm": best_metric,
        "stopped_reason": stopped_reason,
        "selected_batch_size": selected_batch_size,
        "output_dir": str(args.output_dir),
        "test_mae_macro_norm": (
            test_benchmark["metrics"]["overall"]["mae_macro_norm"] if test_benchmark else None
        ),
    }
    write_json(logs_dir / "final_summary.json", final_summary)
    print(json.dumps(final_summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
