package com.ssafy.backend.global.exception;

import org.springframework.http.HttpStatusCode;

public interface ErrorCode {

    String getMessage();

    HttpStatusCode getStatusCode();
}
