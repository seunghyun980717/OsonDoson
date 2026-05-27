from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class PipelineStageError(Exception):
    pipeline: str
    stage: str
    message: str
    status_code: int = 500

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)

    def to_payload(self) -> dict:
        return {
            "type": "error",
            "pipeline": self.pipeline,
            "stage": self.stage,
            "message": self.message,
            "status_code": self.status_code,
        }
