package com.ssafy.backend.domain.translation.controller.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechServiceResponse;
import java.util.List;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Sign2SpeechResponse {

    private final String type;
    private final String source;
    private final List<String> glosses;
    private final String korean;

    @JsonProperty("audio_url")
    private final String audioUrl;

    private final Sign2SpeechAudioResponse audio;

    public static Sign2SpeechResponse from(Sign2SpeechServiceResponse response) {
        return Sign2SpeechResponse.builder()
                .type(response.getType())
                .source(response.getSource())
                .glosses(response.getGlosses())
                .korean(response.getKorean())
                .audioUrl(response.getAudioUrl())
                .audio(Sign2SpeechAudioResponse.from(response.getAudio()))
                .build();
    }
}
