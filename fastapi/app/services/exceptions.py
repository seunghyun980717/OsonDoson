from __future__ import annotations

from app.exceptions import AppError

class ServiceError(AppError):
    """서비스 계층 공통 예외의 기본 클래스."""


class GlossInputEmptyError(ServiceError):
    """정제된 gloss 입력 문자열이 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "gloss 입력이 비어 있습니다.",
        *,
        error_code: str = "GLOSS_INPUT_EMPTY",
        source: str = "sign_to_speech",
        stage: str = "gloss_to_speech",
        status_code: int = 400,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class FrameInputEmptyError(ServiceError):
    """정제된 프레임 입력 리스트가 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "프레임 입력이 비어 있습니다.",
        *,
        error_code: str = "FRAME_INPUT_EMPTY",
        source: str = "sign_to_speech",
        stage: str = "frames_to_speech",
        status_code: int = 400,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class SampleNotFoundError(ServiceError):
    """요청한 샘플 파일을 찾지 못했을 때 발생한다."""

    def __init__(
        self,
        message: str = "요청한 샘플을 찾지 못했습니다.",
        *,
        error_code: str = "SAMPLE_NOT_FOUND",
        source: str = "sign_to_speech",
        stage: str = "sample_to_speech",
        status_code: int = 404,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class NpyPayloadParseError(ServiceError):
    """npy payload 파싱에 실패했을 때 발생한다."""

    def __init__(
        self,
        message: str = "npy payload를 파싱하지 못했습니다.",
        *,
        error_code: str = "NPY_PAYLOAD_PARSE_FAILED",
        source: str = "sign_to_speech",
        stage: str = "npy_to_speech",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class KeypointInputEmptyError(ServiceError):
    """추출된 keypoint 데이터가 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "추출된 keypoint 데이터가 없습니다.",
        *,
        error_code: str = "KEYPOINT_INPUT_EMPTY",
        source: str = "sign_to_speech",
        stage: str = "keypoints_to_speech",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class KeypointShapeInvalidError(ServiceError):
    """keypoint 데이터의 shape이 예상과 다를 때 발생한다."""

    def __init__(
        self,
        message: str = "keypoint 데이터 형식이 올바르지 않습니다.",
        *,
        error_code: str = "KEYPOINT_SHAPE_INVALID",
        source: str = "sign_to_speech",
        stage: str = "keypoints_to_speech",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class TranslationFailedError(ServiceError):
    """gloss를 평문으로 번역했지만 사용할 수 있는 결과가 없을 때 발생한다."""

    def __init__(
        self,
        message: str = "gloss를 평문으로 번역하지 못했습니다.",
        *,
        error_code: str = "TRANSLATION_FAILED",
        source: str = "sign_to_speech",
        stage: str = "gloss_to_korean",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class TextInputEmptyError(ServiceError):
    """정제된 텍스트 입력 문자열이 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "입력 텍스트가 비어 있습니다.",
        *,
        error_code: str = "TEXT_INPUT_EMPTY",
        source: str = "speech_to_sign",
        stage: str = "keypoint_pipeline",
        status_code: int = 400,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class GlossSequenceEmptyError(ServiceError):
    """평문을 gloss로 변환했지만 결과 시퀀스가 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "생성된 gloss 시퀀스가 없습니다.",
        *,
        error_code: str = "GLOSS_SEQUENCE_EMPTY",
        source: str = "speech_to_sign",
        stage: str = "korean_to_gloss",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class GlossSequenceGenerationError(ServiceError):
    """CTC 추론 이후 gloss 시퀀스가 비어 있을 때 발생한다."""

    def __init__(
        self,
        message: str = "생성된 gloss 시퀀스가 없습니다.",
        *,
        error_code: str = "GLOSS_SEQUENCE_GENERATION_FAILED",
        source: str = "sign_to_speech",
        stage: str = "ctc_inference",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class VideoClipResolutionError(ServiceError):
    """gloss에 대응되는 비디오 클립을 찾지 못했을 때 발생한다."""

    def __init__(
        self,
        message: str = "생성된 gloss에 대응되는 비디오 클립을 찾지 못했습니다.",
        *,
        error_code: str = "VIDEO_CLIP_RESOLUTION_FAILED",
        source: str = "speech_to_sign",
        stage: str = "clip_planning",
        status_code: int = 422,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )


class VideoComposeFailedError(ServiceError):
    """수어 영상 합성에 실패했을 때 발생한다."""

    def __init__(
        self,
        message: str = "출력 수어 영상을 생성하지 못했습니다.",
        *,
        error_code: str = "VIDEO_COMPOSE_FAILED",
        source: str = "speech_to_sign",
        stage: str = "video_compose",
        status_code: int = 500,
    ) -> None:
        super().__init__(
            message,
            error_code=error_code,
            source=source,
            stage=stage,
            status_code=status_code,
        )
