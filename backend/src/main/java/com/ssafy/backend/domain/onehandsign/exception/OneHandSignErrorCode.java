package com.ssafy.backend.domain.onehandsign.exception;

import com.ssafy.backend.global.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

@Getter
@RequiredArgsConstructor
public enum OneHandSignErrorCode implements ErrorCode {

    ONE_HAND_SIGN_SAVE_FAILED("한손 수어 데이터 저장에 실패했습니다.", HttpStatus.INTERNAL_SERVER_ERROR);

    private final String message;
    private final HttpStatusCode statusCode;
}
