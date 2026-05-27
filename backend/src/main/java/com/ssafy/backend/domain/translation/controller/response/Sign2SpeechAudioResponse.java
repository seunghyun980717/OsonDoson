package com.ssafy.backend.domain.translation.controller.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechAudioServiceResponse;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Sign2SpeechAudioResponse {

    private final String format;

    @JsonProperty("content_type")
    private final String contentType;

    private final String url;

    public static Sign2SpeechAudioResponse from(Sign2SpeechAudioServiceResponse response) {
        if (response == null) {
            return null;
        }

        return Sign2SpeechAudioResponse.builder()
                .format(response.getFormat())
                .contentType(response.getContentType())
                .url(response.getUrl())
                .build();
    }
}
