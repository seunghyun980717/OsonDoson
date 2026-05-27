#!/usr/bin/env python3
"""Train TCN v1 for 2D-to-depth hand lifting.

The model consumes temporal windows from the shared TCN cache and supports two
prediction modes:
  - center: loss/metrics use only the center frame.
  - sequence: loss/metrics use every valid frame in the window.
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
from collections import Counter, defaultdict
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

DEFAULT_TCN_CACHE_ROOT = Path("D:/ssafy/3_\uc790\uc728/artifacts/hand_lifting_full_F/07_tcn_cache/mixed")
DEFAULT_REPO_HAND_LIFTING_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = DEFAULT_REPO_HAND_LIFTING_ROOT / "runs" / "tcn_v1_center"
SPLITS = ("train", "val", "test")
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


def pair_delta_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
    pairs: tuple[tuple[int, int], ...],
) -> torch.Tensor | None:
    losses: list[torch.Tensor] = []
    for a, b in pairs:
        pair_mask = mask[:, a] & mask[:, b] & torch.isfinite(target[:, a]) & torch.isfinite(target[:, b])
        if pair_mask.any():
            pred_delta = pred[pair_mask, a] - pred[pair_mask, b]
            target_delta = target[pair_mask, a] - target[pair_mask, b]
            losses.append((pred_delta - target_delta).abs().mean())
    return torch.stack(losses).mean() if losses else None


class MetricAccumulator:
    """Streaming metrics for full TCN validation/test splits.

    MAE/RMSE/count use every valid target. Percentiles use a bounded sample to
    avoid torch.quantile limits on multi-million-window validation sets.
    """

    PERCENTILE_SAMPLE_LIMIT = 1_000_000

    def __init__(self):
        self.percentile_abs_errors: list[torch.Tensor] = []
        self.percentile_sample_count = 0
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
            active_mask = mask & torch.isfinite(target)
            if active_mask.any():
                active_errors = abs_error[active_mask].detach().cpu()
                remaining = self.PERCENTILE_SAMPLE_LIMIT - self.percentile_sample_count
                if remaining > 0:
                    if active_errors.numel() > remaining:
                        step = max(1, math.ceil(active_errors.numel() / remaining))
                        sample = active_errors[::step][:remaining].contiguous()
                    else:
                        sample = active_errors
                    self.percentile_abs_errors.append(sample)
                    self.percentile_sample_count += int(sample.numel())
                self.micro_sum += float(active_errors.sum())
                self.micro_sq_sum += float((active_errors**2).sum())
                self.micro_count += int(active_errors.numel())

            for hand in HAND_ORDER:
                for group in ("shoulder", "elbow", "wrist", "palm", "finger"):
                    indices = [
                        index
                        for index, spec in enumerate(TARGET_SPECS)
                        if spec["side"] == hand and spec["group"] == group
                    ]
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

        all_abs = torch.cat(self.percentile_abs_errors) if self.percentile_abs_errors else torch.empty(0)
        if all_abs.numel():
            q = torch.quantile(all_abs, torch.tensor([0.5, 0.9, 0.95], dtype=torch.float32))
            percentiles = {
                "p50_abs_error": float(q[0]),
                "p90_abs_error": float(q[1]),
                "p95_abs_error": float(q[2]),
                "percentile_sample_count": int(all_abs.numel()),
            }
        else:
            percentiles = {
                "p50_abs_error": None,
                "p90_abs_error": None,
                "p95_abs_error": None,
                "percentile_sample_count": 0,
            }

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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tcn-cache-root", type=Path, default=DEFAULT_TCN_CACHE_ROOT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--prediction-mode", choices=("center", "sequence"), default="center")
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--channels", type=int, default=384)
    parser.add_argument("--blocks", type=int, default=5)
    parser.add_argument("--kernel-size", type=int, default=3)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--arm-loss-weight", type=float, default=1.0)
    parser.add_argument("--wrist-loss-weight", type=float, default=1.0)
    parser.add_argument("--palm-loss-weight", type=float, default=1.0)
    parser.add_argument("--finger-loss-weight", type=float, default=0.5)
    parser.add_argument("--temporal-loss-weight", type=float, default=0.0)
    parser.add_argument("--accel-loss-weight", type=float, default=0.0)
    parser.add_argument("--bone-loss-weight", type=float, default=0.0)
    parser.add_argument("--max-epochs", type=int, default=50)
    parser.add_argument("--early-stopping-patience", type=int, default=8)
    parser.add_argument("--early-stopping-min-delta", type=float, default=1e-4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--prefetch-factor", type=int, default=4)
    persistent_group = parser.add_mutually_exclusive_group()
    persistent_group.add_argument("--persistent-workers", dest="persistent_workers", action="store_true")
    persistent_group.add_argument("--no-persistent-workers", dest="persistent_workers", action="store_false")
    parser.set_defaults(persistent_workers=None)
    parser.add_argument("--max-train-windows", type=int)
    parser.add_argument("--max-val-windows", type=int)
    parser.add_argument("--max-test-windows", type=int)
    parser.add_argument("--log-every", type=int, default=25)
    progress_group = parser.add_mutually_exclusive_group()
    progress_group.add_argument("--progress", dest="progress", action="store_true")
    progress_group.add_argument("--no-progress", dest="progress", action="store_false")
    parser.set_defaults(progress=True)
    parser.add_argument("--no-test", action="store_true")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be >= 1.")
    if args.kernel_size < 1 or args.kernel_size % 2 == 0:
        parser.error("--kernel-size must be a positive odd number.")
    return args


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def list_tcn_files(root: Path, split: str) -> list[Path]:
    split_dir = root / split
    if not split_dir.exists():
        raise FileNotFoundError(f"TCN cache split directory does not exist: {split_dir}")
    files = sorted(split_dir.glob("*.pt"))
    if not files:
        raise FileNotFoundError(f"No TCN cache shards found in: {split_dir}")
    return files


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but torch.cuda.is_available() is false.")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def progress_iter(iterable: Iterable[Any], total: int | None, desc: str, enabled: bool) -> Iterable[Any]:
    if enabled and tqdm is not None:
        return tqdm(iterable, total=total, desc=desc, dynamic_ncols=True, leave=False)
    return iterable


def progress_write(message: str, enabled: bool) -> None:
    if enabled and tqdm is not None:
        tqdm.write(message)
    else:
        print(message, flush=True)


class TcnTensorShardDataset(IterableDataset):
    def __init__(
        self,
        files: list[Path],
        batch_size: int,
        shuffle: bool,
        seed: int,
        max_windows: int | None,
    ):
        super().__init__()
        self.files = files
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.seed = seed
        self.max_windows = max_windows
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
            if x.shape[-1] != INPUT_LAYOUT["input_dim"]:
                raise ValueError(f"Unexpected input dim in {path}: {x.shape[-1]}")
            if target.shape[-1] != TARGET_LAYOUT["output_dim"] or mask.shape[-1] != TARGET_LAYOUT["output_dim"]:
                raise ValueError(f"Unexpected target/mask dim in {path}: {target.shape[-1]} / {mask.shape[-1]}")

            indices = None
            if self.shuffle:
                generator = torch.Generator()
                path_seed = int(hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:8], 16)
                generator.manual_seed(self.seed + effective_epoch + path_seed)
                indices = torch.randperm(row_count, generator=generator)

            start = 0
            while start < row_count:
                if self.max_windows is not None and emitted >= self.max_windows:
                    return
                stop = min(start + self.batch_size, row_count)
                if self.max_windows is not None:
                    stop = min(stop, start + (self.max_windows - emitted))
                if indices is None:
                    batch = {"x": x[start:stop], "target": target[start:stop], "mask": mask[start:stop], "kind": kind[start:stop]}
                else:
                    selected = indices[start:stop]
                    batch = {
                        "x": x.index_select(0, selected),
                        "target": target.index_select(0, selected),
                        "mask": mask.index_select(0, selected),
                        "kind": kind.index_select(0, selected),
                    }
                valid_rows = batch["mask"].any(dim=(1, 2))
                if valid_rows.any():
                    if not bool(valid_rows.all()):
                        batch = {key: value[valid_rows] for key, value in batch.items()}
                    emitted += int(batch["x"].shape[0])
                    yield batch
                start = stop


class TemporalBlock(nn.Module):
    def __init__(self, channels: int, kernel_size: int, dilation: int, dropout: float):
        super().__init__()
        padding = dilation * (kernel_size - 1) // 2
        self.net = nn.Sequential(
            nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation),
            nn.GroupNorm(1, channels),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation),
            nn.GroupNorm(1, channels),
            nn.GELU(),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.net(x)


class HandLiftTCN(nn.Module):
    def __init__(self, input_dim: int, output_dim: int, channels: int, blocks: int, kernel_size: int, dropout: float):
        super().__init__()
        self.input_proj = nn.Linear(input_dim, channels)
        self.blocks = nn.ModuleList(
            TemporalBlock(channels, kernel_size, dilation=2**index, dropout=dropout)
            for index in range(blocks)
        )
        self.output_norm = nn.LayerNorm(channels)
        self.output_proj = nn.Linear(channels, output_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [B, T, C]
        y = self.input_proj(x).transpose(1, 2).contiguous()
        for block in self.blocks:
            y = block(y)
        y = y.transpose(1, 2).contiguous()
        return self.output_proj(self.output_norm(y))


def target_weight_vector(args: argparse.Namespace, device: torch.device) -> torch.Tensor:
    weights = torch.ones(TARGET_LAYOUT["output_dim"], dtype=torch.float32, device=device)
    for index, spec in enumerate(TARGET_SPECS):
        group = spec["group"]
        if group in ("shoulder", "elbow"):
            weights[index] = float(args.arm_loss_weight)
        elif group == "wrist":
            weights[index] = float(args.wrist_loss_weight)
        elif group == "palm":
            weights[index] = float(args.palm_loss_weight)
        elif group == "finger":
            weights[index] = float(args.finger_loss_weight)
    return weights


def select_for_mode(
    pred: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
    kind: torch.Tensor,
    prediction_mode: str,
    center_index: int,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    if prediction_mode == "center":
        return pred[:, center_index], target[:, center_index], mask[:, center_index], kind
    batch, frames, dims = pred.shape
    flat_pred = pred.reshape(batch * frames, dims)
    flat_target = target.reshape(batch * frames, dims)
    flat_mask = mask.reshape(batch * frames, dims)
    flat_kind = kind.repeat_interleave(frames)
    return flat_pred, flat_target, flat_mask, flat_kind


def weighted_masked_l1_loss(
    selected_pred: torch.Tensor,
    selected_target: torch.Tensor,
    selected_mask: torch.Tensor,
    weights: torch.Tensor,
) -> tuple[torch.Tensor, dict[str, float]]:
    active_mask = selected_mask & torch.isfinite(selected_target)
    if not active_mask.any():
        return selected_pred.sum() * 0.0, {"valid_target_count": 0}
    abs_error = (selected_pred - selected_target).abs()
    weighted_error = abs_error * weights.view(1, -1)
    loss = weighted_error[active_mask].mean()
    details: dict[str, float] = {"valid_target_count": int(active_mask.sum().detach().cpu())}
    for group in ("shoulder", "elbow", "wrist", "palm", "finger"):
        indices = torch.tensor(GROUP_INDICES[group], device=selected_mask.device)
        group_mask = active_mask.index_select(1, indices)
        group_error = abs_error.index_select(1, indices)
        details[f"count_{group}"] = int(group_mask.sum().detach().cpu())
        details[f"loss_{group}"] = float(group_error[group_mask].mean().detach().cpu()) if group_mask.any() else math.nan
    return loss, details


def temporal_regularization(pred: torch.Tensor, weight: float) -> torch.Tensor | None:
    if weight <= 0 or pred.shape[1] < 2:
        return None
    return pred.diff(dim=1).abs().mean() * weight


def acceleration_regularization(pred: torch.Tensor, weight: float) -> torch.Tensor | None:
    if weight <= 0 or pred.shape[1] < 3:
        return None
    return pred.diff(dim=1).diff(dim=1).abs().mean() * weight


def train_loss(
    pred: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
    kind: torch.Tensor,
    args: argparse.Namespace,
    weights: torch.Tensor,
    center_index: int,
) -> tuple[torch.Tensor, dict[str, float]]:
    selected = select_for_mode(pred, target, mask, kind, args.prediction_mode, center_index)
    loss, details = weighted_masked_l1_loss(selected[0], selected[1], selected[2], weights)
    active_mask = selected[2] & torch.isfinite(selected[1])
    bone = pair_delta_loss(selected[0], selected[1], active_mask, BONE_Z_PAIRS + ARM_Z_PAIRS)
    if bone is not None and args.bone_loss_weight > 0:
        loss = loss + bone * args.bone_loss_weight
        details["loss_bone_z_delta"] = float(bone.detach().cpu())
    else:
        details["loss_bone_z_delta"] = math.nan
    temporal = temporal_regularization(pred, args.temporal_loss_weight)
    if temporal is not None:
        loss = loss + temporal
        details["loss_temporal"] = float(temporal.detach().cpu())
    accel = acceleration_regularization(pred, args.accel_loss_weight)
    if accel is not None:
        loss = loss + accel
        details["loss_accel"] = float(accel.detach().cpu())
    return loss, details


def loader_kwargs(num_workers: int, prefetch_factor: int, persistent_workers: bool | None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"num_workers": num_workers, "pin_memory": torch.cuda.is_available()}
    if num_workers > 0:
        kwargs["persistent_workers"] = bool(persistent_workers)
        kwargs["prefetch_factor"] = prefetch_factor
    return kwargs


def make_loader(
    files: list[Path],
    batch_size: int,
    shuffle: bool,
    seed: int,
    max_windows: int | None,
    num_workers: int,
    prefetch_factor: int,
    persistent_workers: bool | None,
) -> tuple[TcnTensorShardDataset, DataLoader]:
    if max_windows is not None and num_workers > 0:
        num_workers = 0
    dataset = TcnTensorShardDataset(files, batch_size, shuffle, seed, max_windows)
    loader = DataLoader(dataset, batch_size=None, **loader_kwargs(num_workers, prefetch_factor, persistent_workers))
    return dataset, loader


def estimate_steps(files: list[Path], batch_size: int, max_windows: int | None) -> int | None:
    count = 0
    for path in files:
        try:
            payload = torch.load(path, map_location="cpu", weights_only=False)
            count += int(payload["x"].shape[0])
        except Exception:
            return None
        if max_windows is not None and count >= max_windows:
            count = max_windows
            break
    return math.ceil(count / batch_size) if count else None


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    split_name: str,
    args: argparse.Namespace,
    center_index: int,
    total_steps: int | None,
) -> dict[str, Any]:
    model.eval()
    metrics = MetricAccumulator()
    with torch.no_grad():
        iterator = progress_iter(loader, total_steps, split_name, args.progress)
        for batch in iterator:
            x = batch["x"].to(device, non_blocking=True)
            target = batch["target"].to(device, non_blocking=True)
            mask = batch["mask"].to(device, non_blocking=True)
            kind = batch["kind"]
            pred = model(x)
            selected_pred, selected_target, selected_mask, selected_kind = select_for_mode(
                pred.cpu(),
                target.cpu(),
                mask.cpu(),
                kind.cpu(),
                args.prediction_mode,
                center_index,
            )
            metrics.update(selected_pred, selected_target, selected_mask, selected_kind)
    return metrics.result()


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    args: argparse.Namespace,
    weights: torch.Tensor,
    center_index: int,
    epoch: int,
    total_steps: int | None,
) -> dict[str, Any]:
    model.train()
    total_loss = 0.0
    steps = 0
    started = time.time()
    iterator = progress_iter(loader, total_steps, f"train epoch {epoch}", args.progress)
    for batch in iterator:
        x = batch["x"].to(device, non_blocking=True)
        target = batch["target"].to(device, non_blocking=True)
        mask = batch["mask"].to(device, non_blocking=True)
        kind = batch["kind"].to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        pred = model(x)
        loss, _ = train_loss(pred, target, mask, kind, args, weights, center_index)
        loss.backward()
        if args.grad_clip_norm > 0:
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip_norm)
        optimizer.step()
        steps += 1
        total_loss += float(loss.detach().cpu())
        if args.progress and hasattr(iterator, "set_postfix"):
            iterator.set_postfix(loss=f"{total_loss / steps:.6f}")
        if args.log_every and steps % args.log_every == 0:
            progress_write(f"epoch={epoch} step={steps} train_loss={total_loss / steps:.6f}", args.progress)
    return {"loss": total_loss / max(steps, 1), "steps": steps, "elapsed_sec": time.time() - started}


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


def load_cache_summary(root: Path) -> dict[str, Any] | None:
    path = root / "hand_lifting_tcn_cache_v1_summary.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = resolve_device(args.device)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(args.seed)

    train_files = list_tcn_files(args.tcn_cache_root, "train")
    val_files = list_tcn_files(args.tcn_cache_root, "val")
    test_files = list_tcn_files(args.tcn_cache_root, "test")
    cache_summary = load_cache_summary(args.tcn_cache_root)
    center_index = int((cache_summary or {}).get("config", {}).get("center_index", 7))
    window_size = int((cache_summary or {}).get("config", {}).get("window_size", 15))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = args.output_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    model = HandLiftTCN(
        INPUT_LAYOUT["input_dim"],
        TARGET_LAYOUT["output_dim"],
        args.channels,
        args.blocks,
        args.kernel_size,
        args.dropout,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    weights = target_weight_vector(args, device)

    train_dataset, train_loader = make_loader(
        train_files,
        args.batch_size,
        True,
        args.seed,
        args.max_train_windows,
        args.num_workers,
        args.prefetch_factor,
        args.persistent_workers,
    )
    val_dataset, val_loader = make_loader(
        val_files,
        args.batch_size,
        False,
        args.seed,
        args.max_val_windows,
        args.num_workers,
        args.prefetch_factor,
        args.persistent_workers,
    )
    test_dataset, test_loader = make_loader(
        test_files,
        args.batch_size,
        False,
        args.seed,
        args.max_test_windows,
        args.num_workers,
        args.prefetch_factor,
        args.persistent_workers,
    )

    config = {
        "model_id": "hand_lifting_tcn_v1",
        "created_at": now_iso(),
        "prediction_mode": args.prediction_mode,
        "tcn_cache_root": str(args.tcn_cache_root),
        "cache_summary_path": str(args.tcn_cache_root / "hand_lifting_tcn_cache_v1_summary.json"),
        "window_size": window_size,
        "center_index": center_index,
        "input_layout": INPUT_LAYOUT,
        "target_layout": TARGET_LAYOUT,
        "hyperparameters": {
            "batch_size": args.batch_size,
            "channels": args.channels,
            "blocks": args.blocks,
            "kernel_size": args.kernel_size,
            "dropout": args.dropout,
            "arm_loss_weight": args.arm_loss_weight,
            "wrist_loss_weight": args.wrist_loss_weight,
            "palm_loss_weight": args.palm_loss_weight,
            "finger_loss_weight": args.finger_loss_weight,
            "temporal_loss_weight": args.temporal_loss_weight,
            "accel_loss_weight": args.accel_loss_weight,
            "bone_loss_weight": args.bone_loss_weight,
            "lr": args.lr,
            "weight_decay": args.weight_decay,
            "grad_clip_norm": args.grad_clip_norm,
            "max_epochs": args.max_epochs,
            "early_stopping_patience": args.early_stopping_patience,
            "early_stopping_min_delta": args.early_stopping_min_delta,
        },
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "device": str(device),
            "cuda_available": torch.cuda.is_available(),
            "cuda_device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "git_commit": git_commit(DEFAULT_REPO_HAND_LIFTING_ROOT.parents[2]),
        },
        "source_files": {
            "train": [str(path) for path in train_files],
            "val": [str(path) for path in val_files],
            "test": [str(path) for path in test_files],
        },
    }
    write_json(args.output_dir / "hand_lifting_tcn_v1_train_config.json", config)

    train_steps = estimate_steps(train_files, args.batch_size, args.max_train_windows)
    val_steps = estimate_steps(val_files, args.batch_size, args.max_val_windows)
    test_steps = estimate_steps(test_files, args.batch_size, args.max_test_windows)
    history = []
    best_metric = float("inf")
    best_path = args.output_dir / "hand_lifting_tcn_v1_best.pt"
    last_path = args.output_dir / "hand_lifting_tcn_v1_last.pt"
    bad_epochs = 0
    stopped_reason = "max_epochs"

    log_path = logs_dir / "train_log.jsonl"
    with log_path.open("w", encoding="utf-8") as log_fp:
        for epoch in range(1, args.max_epochs + 1):
            train_dataset.set_epoch(epoch)
            val_dataset.set_epoch(epoch)
            train_stats = train_one_epoch(model, train_loader, optimizer, device, args, weights, center_index, epoch, train_steps)
            val_metrics = evaluate(model, val_loader, device, "val", args, center_index, val_steps)
            val_metric = val_metrics["overall"]["mae_macro_norm"]
            if val_metric is None:
                raise RuntimeError("Validation metric is None; no valid validation targets were evaluated.")
            scheduler.step(val_metric)
            improved = val_metric < best_metric - args.early_stopping_min_delta
            if improved:
                best_metric = float(val_metric)
                bad_epochs = 0
            else:
                bad_epochs += 1
            epoch_record = {
                "epoch": epoch,
                "train": train_stats,
                "val": val_metrics,
                "val_mae_macro_norm": val_metric,
                "best_val_mae_macro_norm": best_metric,
                "bad_epochs": bad_epochs,
                "improved": improved,
                "lr": optimizer.param_groups[0]["lr"],
            }
            history.append(epoch_record)
            log_fp.write(json.dumps(epoch_record, ensure_ascii=False) + "\n")
            log_fp.flush()
            save_checkpoint(last_path, model, optimizer, scheduler, epoch, config, val_metrics, best_metric)
            if improved:
                save_checkpoint(best_path, model, optimizer, scheduler, epoch, config, val_metrics, best_metric)
            progress_write(
                f"epoch={epoch} train_loss={train_stats['loss']:.6f} val_mae_macro={val_metric:.6f} best={best_metric:.6f} bad_epochs={bad_epochs}",
                args.progress,
            )
            if bad_epochs >= args.early_stopping_patience:
                stopped_reason = "early_stopping"
                break

    best_checkpoint = torch.load(best_path, map_location=device, weights_only=False)
    model.load_state_dict(best_checkpoint["model_state_dict"])
    best_val_metrics = evaluate(model, val_loader, device, "val_best", args, center_index, val_steps)

    val_benchmark = {
        "schema_version": "hand-lifting-benchmark/v1",
        "split": "val",
        "run": {"model_id": "hand_lifting_tcn_v1", "prediction_mode": args.prediction_mode, "best_checkpoint": str(best_path)},
        "metrics": best_val_metrics,
    }
    write_json(args.output_dir / "hand_lifting_tcn_v1_benchmark_val.json", val_benchmark)

    test_benchmark = None
    if not args.no_test:
        test_metrics = evaluate(model, test_loader, device, "test", args, center_index, test_steps)
        test_benchmark = {
            "schema_version": "hand-lifting-benchmark/v1",
            "split": "test",
            "run": {"model_id": "hand_lifting_tcn_v1", "prediction_mode": args.prediction_mode, "best_checkpoint": str(best_path)},
            "metrics": test_metrics,
        }
        write_json(args.output_dir / "hand_lifting_tcn_v1_benchmark_test.json", test_benchmark)

    profile = {
        "profile_schema_version": "hand-lifting-profile/v1",
        "model_id": "hand_lifting_tcn_v1",
        "prediction_mode": args.prediction_mode,
        "checkpoint": str(best_path),
        "config": config,
        "training": {
            "best_val_mae_macro_norm": best_metric,
            "stopped_epoch": history[-1]["epoch"] if history else None,
            "early_stopping_reason": stopped_reason,
        },
    }
    write_json(args.output_dir / "hand_lifting_tcn_v1_profile.json", profile)
    final_summary = {
        "model_id": "hand_lifting_tcn_v1",
        "prediction_mode": args.prediction_mode,
        "best_val_mae_macro_norm": best_metric,
        "stopped_reason": stopped_reason,
        "output_dir": str(args.output_dir),
        "test_mae_macro_norm": test_benchmark["metrics"]["overall"]["mae_macro_norm"] if test_benchmark else None,
    }
    write_json(logs_dir / "final_summary.json", final_summary)
    print(json.dumps(final_summary, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
