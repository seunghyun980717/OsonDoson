package com.ssafy.backend.global.exception;

import com.ssafy.backend.global.response.ApiResponse;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import java.util.Objects;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(GlobalException.class)
    public ResponseEntity<ApiResponse<Void>> handleGlobalException(GlobalException exception) {
        ErrorCode errorCode = exception.getErrorCode();

        if (exception instanceof TranslationClientException clientException) {
            return ResponseEntity
                    .status(errorCode.getStatusCode())
                    .body(new ApiResponse<>(
                            clientException.getClientCode(),
                            clientException.getClientMessage(),
                            null
                    ));
        }

        return ResponseEntity
                .status(errorCode.getStatusCode())
                .body(new ApiResponse<>(
                        ((Enum<?>) errorCode).name(),
                        errorCode.getMessage(),
                        null
                ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationException(
            MethodArgumentNotValidException exception
    ) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse("입력값이 올바르지 않습니다.");

        return ResponseEntity.badRequest()
                .body(new ApiResponse<>("VALIDATION_ERROR", message, null));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingRequestPartException(
            MissingServletRequestPartException exception
    ) {
        String message = String.format("필수 multipart 파트 '%s'가 없습니다.", exception.getRequestPartName());

        return ResponseEntity.badRequest()
                .body(new ApiResponse<>("VALIDATION_ERROR", message, null));
    }
}
