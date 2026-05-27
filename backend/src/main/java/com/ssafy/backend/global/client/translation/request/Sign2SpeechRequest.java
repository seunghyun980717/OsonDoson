package com.ssafy.backend.global.client.translation.request;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Sign2SpeechRequest {

    private String type;
    private List<MediaPipeFrameRequest> frames;
}
