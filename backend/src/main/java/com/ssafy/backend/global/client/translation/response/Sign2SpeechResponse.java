package com.ssafy.backend.global.client.translation.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class Sign2SpeechResponse {

    private String type;
    private String source;
    private List<String> glosses;
    private String korean;

    @JsonProperty("audio_url")
    private String audioUrl;

    private Sign2SpeechAudioResponse audio;
}
