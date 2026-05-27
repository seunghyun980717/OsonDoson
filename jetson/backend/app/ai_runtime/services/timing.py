from __future__ import annotations

import time
from contextlib import contextmanager


class PipelineTimer:
    def __init__(self, name: str):
        self.name = name
        self.timings: dict[str, float] = {}
        self._started = time.perf_counter()

    @contextmanager
    def step(self, name: str):
        started = time.perf_counter()
        yield
        self.timings[name] = round(time.perf_counter() - started, 3)

    def finish(self) -> dict[str, float]:
        self.timings["total"] = round(time.perf_counter() - self._started, 3)
        return self.timings

    def snapshot(self) -> dict[str, float]:
        snapshot = dict(self.timings)
        snapshot["elapsed"] = round(time.perf_counter() - self._started, 3)
        return snapshot

    def format(self) -> str:
        timings = self.snapshot()
        ordered = [
            f"{name}={value:.3f}s"
            for name, value in timings.items()
        ]
        return ", ".join(ordered)
