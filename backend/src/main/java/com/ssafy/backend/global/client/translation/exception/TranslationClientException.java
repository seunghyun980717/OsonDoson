package com.ssafy.backend.global.client.translation.exception;

import com.ssafy.backend.global.exception.GlobalException;
import lombok.Getter;

@Getter
public class TranslationClientException extends GlobalException {

    private final String clientCode;
    private final String clientMessage;
    private final Integer clientStatus;
    private final String clientSource;
    private final String clientStage;

    public TranslationClientException(TranslationClientErrorCode errorCode) {
        super(errorCode);
        this.clientCode = errorCode.name();
        this.clientMessage = errorCode.getMessage();
        this.clientStatus = errorCode.getStatusCode().value();
        this.clientSource = null;
        this.clientStage = null;
    }

    public TranslationClientException(
            TranslationClientErrorCode errorCode,
            String clientCode,
            String clientMessage,
            Integer clientStatus,
            String clientSource,
            String clientStage
    ) {
        super(errorCode);
        this.clientCode = clientCode != null && !clientCode.isBlank() ? clientCode : errorCode.name();
        this.clientMessage = clientMessage != null && !clientMessage.isBlank()
                ? clientMessage
                : errorCode.getMessage();
        this.clientStatus = clientStatus != null ? clientStatus : errorCode.getStatusCode().value();
        this.clientSource = clientSource;
        this.clientStage = clientStage;
    }
}
