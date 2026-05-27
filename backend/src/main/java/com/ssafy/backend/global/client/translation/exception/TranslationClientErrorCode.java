package com.ssafy.backend.global.client.translation.exception;

import com.ssafy.backend.global.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

@Getter
@RequiredArgsConstructor
public enum TranslationClientErrorCode implements ErrorCode {

    FASTAPI_BAD_REQUEST("FastAPI 요청 형식이 올바르지 않습니다.", HttpStatus.BAD_GATEWAY),
    FASTAPI_UNAUTHORIZED("FastAPI 인증에 실패했습니다.", HttpStatus.BAD_GATEWAY),
    FASTAPI_NOT_FOUND("FastAPI 엔드포인트를 찾을 수 없습니다.", HttpStatus.BAD_GATEWAY),
    FASTAPI_SERVER_ERROR("FastAPI 서버 오류가 발생했습니다.", HttpStatus.BAD_GATEWAY),
    FASTAPI_CONNECTION_FAILED("FastAPI 서버에 연결할 수 없습니다.", HttpStatus.BAD_GATEWAY);

    private final String message;
    private final HttpStatusCode statusCode;
}
