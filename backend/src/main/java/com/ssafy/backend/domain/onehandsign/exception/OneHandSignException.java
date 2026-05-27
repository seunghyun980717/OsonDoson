package com.ssafy.backend.domain.onehandsign.exception;

import com.ssafy.backend.global.exception.GlobalException;

public class OneHandSignException extends GlobalException {

    public OneHandSignException(OneHandSignErrorCode errorCode) {
        super(errorCode);
    }
}
