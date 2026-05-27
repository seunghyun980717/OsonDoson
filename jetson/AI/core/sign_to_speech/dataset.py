"""
Sign-to-Speech 학습용 PyTorch Dataset

Vocabulary 빌드 우선순위:
  1. word_db.json 키 기반 (clip이 실제 있는 글로스만) ← 통합 DB 구축 후
  2. fallback: NIA_SEN_train.csv 글로스 시퀀스 기반

CSV row 포맷: (idx, video_name, gloss_sequence)
  ex) 0, NIA_SL_SEN1912_REAL01_F.mp4, 버스 곳 내리다 맞다

__getitem__ 반환:
  keypoints: (T, 134) float32 tensor
  labels:    [int, ...] 글로스 인덱스 (CTC target)
"""
import csv
import json
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import torch
from torch.utils.data import Dataset

from core.config import (
    TRAIN_CSV, VAL_CSV,
    TRAIN_KEYPOINT_ZIP, VAL_KEYPOINT_ZIP,
    VOCAB_PATH, WORD_DB_PATH, KEYPOINT_DIM,
    KEYPOINT_ZIP_PREFIX,
)
from core.data_utils.keypoint_loader import load_video_keypoints


class Vocabulary:
    BLANK = "<blank>"
    UNK   = "<unk>"

    def __init__(self):
        # blank 반드시 index 0 (PyTorch CTCLoss 기본값)
        self.tokens = [self.BLANK, self.UNK]
        self.stoi   = {self.BLANK: 0, self.UNK: 1}

    def build_from_word_db(self, db_path: Path):
        """word_db.json 키(clip 보유 글로스)로 vocab 구성. 통합 DB 기반."""
        with open(db_path, encoding="utf-8") as f:
            db = json.load(f)
        for g in sorted(db.keys()):
            g = g.strip()
            if g and g not in self.stoi:
                self.stoi[g] = len(self.tokens)
                self.tokens.append(g)

    def build_from_csv(self, csv_path: Path):
        """CSV 글로스 시퀀스 기반 vocab 구성. word_db 없을 때 fallback."""
        glosses: set = set()
        with open(csv_path, encoding="euc-kr") as f:
            for row in csv.reader(f):
                if len(row) >= 3 and row[2].strip():
                    for g in row[2].strip().split():
                        glosses.add(g)
        for g in sorted(glosses):
            if g not in self.stoi:
                self.stoi[g] = len(self.tokens)
                self.tokens.append(g)

    def save(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.tokens, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: Path) -> "Vocabulary":
        with open(path, encoding="utf-8") as f:
            tokens = json.load(f)
        v = cls()
        v.tokens = tokens
        v.stoi   = {t: i for i, t in enumerate(tokens)}
        return v

    def encode(self, glosses: List[str]) -> List[int]:
        return [self.stoi.get(g, self.stoi[self.UNK]) for g in glosses]

    def decode(self, indices: List[int]) -> List[str]:
        return [self.tokens[i] for i in indices if i not in (0, 1)]

    def __len__(self):
        return len(self.tokens)


def get_or_build_vocab(force: bool = False) -> Vocabulary:
    """
    vocab.json 로드 또는 빌드.

    빌드 전략: word_db(있으면) + TRAIN_CSV 합집합
      - word_db: Speech-to-Sign 클립 글로스
      - TRAIN_CSV: CTC 학습 정답 글로스 전체 (30k 기준)
      - 두 소스의 합집합으로 구성해야 CTC 학습 시 <unk> 0개 보장

    Args:
        force: True면 기존 vocab.json 무시하고 무조건 재빌드
    """
    # 재빌드 필요 여부 확인
    if not force and VOCAB_PATH.exists():
        if WORD_DB_PATH.exists():
            if WORD_DB_PATH.stat().st_mtime <= VOCAB_PATH.stat().st_mtime:
                return Vocabulary.load(VOCAB_PATH)
            print("[vocab] word_db 갱신 감지 → vocab 재빌드")
        else:
            return Vocabulary.load(VOCAB_PATH)

    vocab = Vocabulary()

    # 1) word_db 기반 (있으면)
    if WORD_DB_PATH.exists():
        vocab.build_from_word_db(WORD_DB_PATH)
        print(f"[vocab] word_db 로드: {len(vocab)}개")

    # 2) TRAIN_CSV 글로스 추가 — word_db에 없는 글로스도 커버
    before = len(vocab)
    vocab.build_from_csv(TRAIN_CSV)
    added = len(vocab) - before
    if added:
        print(f"[vocab] CSV 추가: +{added}개 (word_db 미포함 글로스)")

    vocab.save(VOCAB_PATH)
    print(f"[vocab] 빌드 완료: {len(vocab)}개 토큰 → {VOCAB_PATH}")
    return vocab


class SignDataset(Dataset):
    """
    문장 keypoint + CSV 글로스 레이블로 CTC 학습 Dataset.
    keypoint zip 경로에 따라 zip_inner_prefix를 자동으로 결정.
    """

    def __init__(
        self,
        split: str = "train",
        vocab: Optional[Vocabulary] = None,
        max_frames: int = 512,
    ):
        assert split in ("train", "val")
        self.split      = split
        self.max_frames = max_frames
        self.vocab      = vocab or get_or_build_vocab()

        csv_path      = TRAIN_CSV          if split == "train" else VAL_CSV
        self.zip_path = TRAIN_KEYPOINT_ZIP if split == "train" else VAL_KEYPOINT_ZIP
        self.zip_prefix = KEYPOINT_ZIP_PREFIX.get(str(self.zip_path), "")

        self.samples = self._load_csv(csv_path)
        print(f"[SignDataset] {split}: {len(self.samples)}개 샘플, vocab={len(self.vocab)}")

    def _load_csv(self, csv_path: Path) -> List[Tuple[str, List[int]]]:
        samples = []
        with open(csv_path, encoding="euc-kr") as f:
            reader = csv.reader(f)
            next(reader)  # header
            for row in reader:
                if len(row) < 3 or not row[2].strip():
                    continue
                video_name = row[1].replace(".mp4", "")
                glosses    = row[2].strip().split()
                label_ids  = self.vocab.encode(glosses)
                samples.append((video_name, label_ids))
        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        video_name, label_ids = self.samples[idx]

        seq = load_video_keypoints(
            self.zip_path, video_name,
            zip_inner_prefix=self.zip_prefix,
            use_cache=True,
        )

        if seq is None:
            seq = np.zeros((1, KEYPOINT_DIM), dtype=np.float32)

        if len(seq) > self.max_frames:
            seq = seq[:self.max_frames]

        return torch.from_numpy(seq), torch.tensor(label_ids, dtype=torch.long)

    @staticmethod
    def collate_fn(batch):
        kps, labels = zip(*batch)

        T_list = [k.shape[0] for k in kps]
        max_T  = max(T_list)
        B, D   = len(kps), kps[0].shape[1]
        kp_pad = torch.zeros(B, max_T, D)
        for i, (k, t) in enumerate(zip(kps, T_list)):
            kp_pad[i, :t] = k

        L_list    = [len(l) for l in labels]
        label_cat = torch.cat(labels)

        return (
            kp_pad,
            torch.tensor(T_list, dtype=torch.long),
            label_cat,
            torch.tensor(L_list, dtype=torch.long),
        )
