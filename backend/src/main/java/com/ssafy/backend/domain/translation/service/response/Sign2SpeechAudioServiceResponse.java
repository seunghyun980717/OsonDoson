package com.ssafy.backend.domain.translation.service.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Sign2SpeechAudioServiceResponse {

    private final String format;
    private final String contentType;
    private final String url;
}
