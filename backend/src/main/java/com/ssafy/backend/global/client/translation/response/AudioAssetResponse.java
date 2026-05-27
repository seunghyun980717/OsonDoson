package com.ssafy.backend.global.client.translation.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class AudioAssetResponse {

    private final byte[] body;
    private final String contentType;
    private final Long contentLength;
}
