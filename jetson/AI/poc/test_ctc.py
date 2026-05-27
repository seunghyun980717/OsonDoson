"""
CTC 추론 빠른 테스트

API 서버 없이 cache/*.npy 파일로 직접 모델 테스트.

실행:
    # 무작위 샘플 5개
    python test_ctc.py

    # 특정 파일
    python test_ctc.py --npy cache/NIA_SL_SEN0001_REAL01_F.npy

    # HTTP API 테스트 (서버 실행 중이어야 함)
    python test_ctc.py --api

    # API + 특정 파일
    python test_ctc.py --api --npy cache/NIA_SL_SEN0001_REAL01_F.npy
"""
import argparse
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))


def test_direct(npy_path: Path):
    """모델 직접 호출 — API 서버 불필요"""
    from sign_to_speech.infer import load_model, ctc_decode
    from sign_to_speech.gloss_to_korean import gloss_to_korean

    model, vocab = load_model()

    kp = np.load(npy_path)                          # (T, 134) 정규화 완료
    print(f"  shape : {kp.shape}  ({kp.shape[0]} frames)")

    t0 = time.perf_counter()
    x  = torch.from_numpy(kp).float().unsqueeze(0)  # (1, T, 134)
    with torch.no_grad():
        log_probs, _ = model(x)
    gloss = ctc_decode(log_probs, vocab)
    elapsed = time.perf_counter() - t0

    print(f"  글로스: {gloss!r}  ({elapsed*1000:.1f}ms)")

    if gloss:
        korean = gloss_to_korean(gloss)
        print(f"  한국어: {korean!r}")

    return gloss


def test_api(npy_path: Path, url: str = "http://localhost:8000"):
    """
    /sign-to-speech/keypoints 엔드포인트 테스트.
    (T, 134) numpy → JSON list → POST
    """
    import json
    import urllib.request

    kp = np.load(npy_path)
    payload = json.dumps({"keypoints": kp.tolist()}).encode()

    req = urllib.request.Request(
        f"{url}/sign-to-speech/keypoints",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        elapsed = time.perf_counter() - t0
        print(f"  글로스: {result.get('gloss')!r}")
        print(f"  한국어: {result.get('korean')!r}")
        print(f"  소요:   {elapsed*1000:.0f}ms")
        print(f"  타이밍: {result.get('timings')}")
    except Exception as e:
        print(f"  API 오류: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--npy",  type=Path, default=None, help="cache/*.npy 파일 경로")
    parser.add_argument("--n",    type=int,  default=5,    help="무작위 샘플 수 (--npy 미지정 시)")
    parser.add_argument("--api",  action="store_true",     help="API 서버 테스트 (localhost:8000)")
    parser.add_argument("--url",  default="http://localhost:8000")
    args = parser.parse_args()

    cache_dir = Path(__file__).parent / "cache"
    if args.npy:
        samples = [args.npy]
    else:
        all_npy = list(cache_dir.glob("*.npy"))
        if not all_npy:
            print("[ERROR] cache/*.npy 파일 없음. precache 먼저 실행하세요.")
            sys.exit(1)
        samples = random.sample(all_npy, min(args.n, len(all_npy)))

    for npy in samples:
        print(f"\n{'─'*50}")
        print(f"파일: {npy.name}")
        if args.api:
            test_api(npy, args.url)
        else:
            test_direct(npy)

    print(f"\n{'─'*50}")


if __name__ == "__main__":
    main()
