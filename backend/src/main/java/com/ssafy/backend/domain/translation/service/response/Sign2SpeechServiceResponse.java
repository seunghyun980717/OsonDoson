package com.ssafy.backend.domain.translation.service.response;

import java.util.List;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Sign2SpeechServiceResponse {

    private final String type;
    private final String source;
    private final List<String> glosses;
    private final String korean;
    private final String audioUrl;
    private final Sign2SpeechAudioServiceResponse audio;
}
