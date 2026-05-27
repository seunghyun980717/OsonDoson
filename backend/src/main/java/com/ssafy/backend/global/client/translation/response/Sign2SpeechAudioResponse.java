package com.ssafy.backend.global.client.translation.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class Sign2SpeechAudioResponse {

    private String format;

    @JsonProperty("content_type")
    private String contentType;

    private String url;
}
