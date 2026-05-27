import time
from contextlib import contextmanager


@contextmanager
def step_timer(name: str, timings: dict | None = None):
    t0 = time.perf_counter()
    yield
    elapsed = round(time.perf_counter() - t0, 3)
    print(f"  [{name}] {elapsed:.3f}s")
    if timings is not None:
        timings[name] = elapsed


class PipelineTimer:
    def __init__(self, pipeline_name: str):
        self.name = pipeline_name
        self.timings: dict[str, float] = {}
        self._start = time.perf_counter()
        print(f"\n{'='*50}")
        print(f"[{pipeline_name}] 시작")
        print(f"{'='*50}")

    def step(self, name: str):
        return step_timer(name, self.timings)

    def finish(self) -> dict:
        total = round(time.perf_counter() - self._start, 3)
        self.timings["총"] = total
        print(f"  {'─'*30}")
        print(f"  [총 소요] {total:.3f}s")
        print(f"{'='*50}\n")
        return self.timings
