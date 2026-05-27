package com.ssafy.backend.global.client.translation.response;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class FastApiErrorResponse {

    private ErrorDetail error;

    @Getter
    @NoArgsConstructor
    public static class ErrorDetail {
        private String code;
        private String message;
        private String source;
        private String stage;
        private Integer status;
    }
}
