from __future__ import annotations


class AppError(Exception):
    """애플리케이션 공통 예외의 기본 클래스."""

    def __init__(
        self,
        message: str,
        *,
        error_code: str,
        source: str,
        stage: str,
        status_code: int,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.source = source
        self.stage = stage
        self.status_code = status_code
