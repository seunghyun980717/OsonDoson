from __future__ import annotations

import argparse
import sys
import statistics
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.main import create_app


def measure_endpoint(client: TestClient, method: str, url: str, payload=None, runs: int = 3) -> dict[str, float]:
    samples: list[float] = []
    for _ in range(runs):
        started = time.perf_counter()
        if method == "GET":
            response = client.get(url)
        else:
            response = client.post(url, json=payload)
        elapsed = time.perf_counter() - started
        response.raise_for_status()
        samples.append(elapsed)
    return {
        "min_s": round(min(samples), 3),
        "avg_s": round(statistics.mean(samples), 3),
        "max_s": round(max(samples), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a small in-process performance smoke test.")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()

    with TestClient(create_app()) as client:
        results = {
            "health": measure_endpoint(client, "GET", "/health", runs=args.runs),
            "speech_to_sign_text": measure_endpoint(
                client,
                "POST",
                "/speech-to-sign/text",
                payload={"text": "안녕하세요"},
                runs=args.runs,
            ),
            "sign_to_speech_sample": measure_endpoint(
                client,
                "POST",
                "/sign-to-speech/sample?name=NIA_SL_SEN0001_REAL01_F",
                runs=args.runs,
            ),
        }

    for name, metrics in results.items():
        print(f"[perf] {name}: min={metrics['min_s']}s avg={metrics['avg_s']}s max={metrics['max_s']}s")


if __name__ == "__main__":
    main()
