"""
Conformer CTC model for sign-to-gloss recognition (sign-v2).

Architecture reverse-engineered from checkpoint key names:
  input_proj          : nn.Linear (single layer, not Sequential)
  blocks              : nn.ModuleList of ConformerBlock (was 'encoder')
  blocks.X.attn       : AttentionModule wrapper (norm + MHA)
  blocks.X.conv       : ConvModule with pw1/dw/bn/pw2 naming
  blocks.X.norm       : final LayerNorm (was 'final_norm')
  ctc_head            : nn.Linear
"""
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from app.ai_runtime.core.config import (
    DROPOUT,
    KEYPOINT_DIM,
    SIGN_CONV_KERNEL,
    SIGN_MODEL_DIM,
    SIGN_MODEL_FF_MULT,
    SIGN_MODEL_HEADS,
    SIGN_MODEL_LAYERS,
)


def _logsumexp(a: float, b: float) -> float:
    if a == float("-inf"):
        return b
    if b == float("-inf"):
        return a
    m = max(a, b)
    return m + float(np.log(np.exp(a - m) + np.exp(b - m)))


def _collapse_repeated_ngrams(tokens: list[str], max_n: int = 4) -> list[str]:
    if len(tokens) < 2:
        return tokens

    changed = True
    output = tokens[:]
    while changed:
        changed = False
        i = 0
        collapsed: list[str] = []
        while i < len(output):
            reduced = False
            max_chunk = min(max_n, (len(output) - i) // 2)
            for n in range(max_chunk, 0, -1):
                left = output[i : i + n]
                right = output[i + n : i + 2 * n]
                if left == right:
                    collapsed.extend(left)
                    i += 2 * n
                    while i + n <= len(output) and output[i - n : i] == output[i : i + n]:
                        i += n
                    changed = True
                    reduced = True
                    break
            if not reduced:
                collapsed.append(output[i])
                i += 1
        output = collapsed
    return output


def ctc_greedy_decode(log_probs: torch.Tensor, vocab) -> list[str]:
    preds = log_probs.argmax(dim=-1).permute(1, 0)
    results = []
    for seq in preds:
        tokens, prev = [], None
        for idx in seq.tolist():
            if idx != prev and idx != 0:
                tokens.append(vocab.tokens[idx])
            prev = idx
        tokens = _collapse_repeated_ngrams(tokens)
        results.append(" ".join(tokens))
    return results


def ctc_beam_decode(log_probs: torch.Tensor, vocab, beam_size: int = 8) -> list[str]:
    probs = log_probs.detach().cpu().numpy()
    results: list[str] = []

    for batch_idx in range(probs.shape[1]):
        beam: dict[tuple[int, ...], tuple[float, float]] = {(): (0.0, float("-inf"))}
        for t in range(probs.shape[0]):
            next_beam: dict[tuple[int, ...], tuple[float, float]] = {}
            frame = probs[t, batch_idx]
            top_indices = np.argsort(frame)[-beam_size:]

            for prefix, (p_blank, p_non_blank) in beam.items():
                for idx in top_indices:
                    p = float(frame[idx])
                    if idx == 0:
                        nb = next_beam.get(prefix, (float("-inf"), float("-inf")))
                        next_beam[prefix] = (_logsumexp(nb[0], _logsumexp(p_blank + p, p_non_blank + p)), nb[1])
                        continue

                    new_prefix = prefix + (int(idx),)
                    last = prefix[-1] if prefix else None

                    if idx == last:
                        same = next_beam.get(prefix, (float("-inf"), float("-inf")))
                        next_beam[prefix] = (same[0], _logsumexp(same[1], p_non_blank + p))
                        ext = next_beam.get(new_prefix, (float("-inf"), float("-inf")))
                        next_beam[new_prefix] = (ext[0], _logsumexp(ext[1], p_blank + p))
                    else:
                        ext = next_beam.get(new_prefix, (float("-inf"), float("-inf")))
                        next_beam[new_prefix] = (
                            ext[0],
                            _logsumexp(ext[1], _logsumexp(p_blank + p, p_non_blank + p)),
                        )

            beam = dict(
                sorted(
                    next_beam.items(),
                    key=lambda item: _logsumexp(item[1][0], item[1][1]),
                    reverse=True,
                )[:beam_size]
            )

        best_prefix = max(beam.items(), key=lambda item: _logsumexp(item[1][0], item[1][1]))[0]
        collapsed = []
        prev = None
        for idx in best_prefix:
            if idx != prev and idx != 0:
                collapsed.append(vocab.tokens[idx])
            prev = idx
        results.append(" ".join(collapsed))

    return results


class FeedForwardModule(nn.Module):
    def __init__(self, dim: int, ff_mult: int, dropout: float):
        super().__init__()
        hidden = dim * ff_mult
        self.net = nn.Sequential(
            nn.LayerNorm(dim),
            nn.Linear(dim, hidden),
            nn.SiLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, dim),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class AttentionModule(nn.Module):
    """Attention with pre-norm wrapped into a sub-module (matches checkpoint: attn.norm, attn.attn)."""

    def __init__(self, dim: int, heads: int, dropout: float):
        super().__init__()
        self.norm = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(
            embed_dim=dim,
            num_heads=heads,
            dropout=dropout,
            batch_first=True,
        )

    def forward(self, x: torch.Tensor, key_padding_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        x_norm = self.norm(x)
        out, _ = self.attn(x_norm, x_norm, x_norm, key_padding_mask=key_padding_mask, need_weights=False)
        return out


class ConvModule(nn.Module):
    """Convolution sub-module (matches checkpoint: norm/pw1/dw/bn/pw2 naming)."""

    def __init__(self, dim: int, kernel_size: int, dropout: float):
        super().__init__()
        padding = kernel_size // 2
        self.norm = nn.LayerNorm(dim)
        self.pw1 = nn.Conv1d(dim, dim * 2, kernel_size=1)
        self.dw = nn.Conv1d(dim, dim, kernel_size=kernel_size, padding=padding, groups=dim)
        self.bn = nn.BatchNorm1d(dim)
        self.pw2 = nn.Conv1d(dim, dim, kernel_size=1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, C)
        x = self.norm(x)
        x = x.transpose(1, 2)          # (B, C, T)
        x = F.glu(self.pw1(x), dim=1)  # (B, C, T)
        x = self.dw(x)
        x = self.bn(x)
        x = F.silu(x)
        x = self.pw2(x)
        x = self.dropout(x)
        return x.transpose(1, 2)       # (B, T, C)


class ConformerBlock(nn.Module):
    def __init__(self, dim: int, heads: int, ff_mult: int, kernel_size: int, dropout: float):
        super().__init__()
        self.ff1 = FeedForwardModule(dim, ff_mult, dropout)
        self.attn = AttentionModule(dim, heads, dropout)
        self.conv = ConvModule(dim, kernel_size, dropout)
        self.ff2 = FeedForwardModule(dim, ff_mult, dropout)
        self.norm = nn.LayerNorm(dim)

    def forward(self, x: torch.Tensor, key_padding_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        x = x + 0.5 * self.ff1(x)
        x = x + self.attn(x, key_padding_mask)
        x = x + self.conv(x)
        x = x + 0.5 * self.ff2(x)
        return self.norm(x)


class SignConformerCTC(nn.Module):
    def __init__(self, vocab_size: int):
        super().__init__()
        dim = SIGN_MODEL_DIM
        self.input_proj = nn.Linear(KEYPOINT_DIM, dim)
        self.blocks = nn.ModuleList(
            [
                ConformerBlock(
                    dim=dim,
                    heads=SIGN_MODEL_HEADS,
                    ff_mult=SIGN_MODEL_FF_MULT,
                    kernel_size=SIGN_CONV_KERNEL,
                    dropout=DROPOUT,
                )
                for _ in range(SIGN_MODEL_LAYERS)
            ]
        )
        self.ctc_head = nn.Linear(dim, vocab_size)

    def encode(
        self,
        x: torch.Tensor,
        lengths: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        x = self.input_proj(x)

        key_padding_mask = None
        if lengths is not None:
            max_t = x.size(1)
            key_padding_mask = torch.arange(max_t, device=x.device).unsqueeze(0) >= lengths.unsqueeze(1)

        for block in self.blocks:
            x = block(x, key_padding_mask=key_padding_mask)
        return x

    def forward(
        self,
        x: torch.Tensor,
        hidden: Optional[Tuple] = None,
        lengths: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        del hidden
        encoded = self.encode(x, lengths=lengths)
        logits = self.ctc_head(encoded)
        log_probs = F.log_softmax(logits, dim=-1)
        return log_probs.permute(1, 0, 2), encoded


def build_sign_model(vocab_size: int) -> SignConformerCTC:
    return SignConformerCTC(vocab_size=vocab_size)


# Backward-compatible alias.
SignLSTM = SignConformerCTC


class StreamingDecoder:
    """Stateless sliding-window decoder for webcam / chunked inference."""

    def __init__(
        self,
        model: SignConformerCTC,
        vocab,
        device: torch.device,
        window: int = 90,
        stride: int = 30,
    ):
        self.model = model.eval()
        self.vocab = vocab
        self.device = device
        self.window = window
        self.stride = stride
        self.buffer: list = []

    @torch.no_grad()
    def push(self, frame: "np.ndarray") -> Optional[str]:
        import numpy as np

        self.buffer.append(frame)
        if len(self.buffer) < self.window:
            return None

        chunk = np.stack(self.buffer[-self.window :], axis=0)
        x = torch.from_numpy(chunk).float().unsqueeze(0).to(self.device)
        lengths = torch.tensor([x.shape[1]], device=self.device)
        log_probs, _ = self.model(x, lengths=lengths)
        pred = log_probs.argmax(dim=-1).squeeze(1).tolist()
        glosses = self._ctc_decode(pred)
        self.buffer = self.buffer[self.stride :]
        return " ".join(glosses) if glosses else None

    def _ctc_decode(self, indices: list[int]) -> list[str]:
        result, prev = [], None
        for idx in indices:
            if idx != prev and idx != 0:
                result.append(self.vocab.tokens[idx])
            prev = idx
        return result

    def reset(self):
        self.buffer = []
