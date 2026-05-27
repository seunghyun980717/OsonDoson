package com.ssafy.backend.domain.translation.service.request;

import com.ssafy.backend.global.client.translation.request.Sign2SpeechRequest;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Sign2SpeechServiceRequest {

    private String type;
    private List<MediaPipeFrameServiceRequest> frames;

    public Sign2SpeechRequest toClientRequest() {
        return Sign2SpeechRequest.builder()
                .type(type)
                .frames(toClientRequests(frames))
                .build();
    }

    private List<com.ssafy.backend.global.client.translation.request.MediaPipeFrameRequest> toClientRequests(
            List<MediaPipeFrameServiceRequest> requests
    ) {
        if (requests == null) {
            return List.of();
        }

        return requests.stream()
                .map(MediaPipeFrameServiceRequest::toClientRequest)
                .toList();
    }
}
