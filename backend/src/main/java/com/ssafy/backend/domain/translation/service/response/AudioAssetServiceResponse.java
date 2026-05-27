package com.ssafy.backend.domain.translation.service.response;

import com.ssafy.backend.global.client.translation.response.AudioAssetResponse;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class AudioAssetServiceResponse {

    private final byte[] body;
    private final String contentType;
    private final Long contentLength;

    public static AudioAssetServiceResponse from(AudioAssetResponse response) {
        return AudioAssetServiceResponse.builder()
                .body(response.getBody())
                .contentType(response.getContentType())
                .contentLength(response.getContentLength())
                .build();
    }
}
