from __future__ import annotations

from app.exceptions import AppError


class RouterError(AppError):
    """라우터 계층 공통 예외의 기본 클래스."""


class GlossListEmptyError(RouterError):
    """라우터에서 gloss 목록 정제 결과가 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "gloss 목록이 비어 있습니다.",
        *,
        error_code: str = "GLOSS_LIST_EMPTY",
        source: str = "translation_router",
        stage: str = "normalize_glosses",
        status_code: int = 400,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class UploadFileSaveError(RouterError):
    """업로드 파일을 임시 저장하는 데 실패했을 때 발생한다."""

    def __init__(
        self,
        message: str = "업로드 파일을 임시 저장하지 못했습니다.",
        *,
        error_code: str = "UPLOAD_FILE_SAVE_FAILED",
        source: str = "translation_router",
        stage: str = "save_upload_to_temp_file",
        status_code: int = 500,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )
