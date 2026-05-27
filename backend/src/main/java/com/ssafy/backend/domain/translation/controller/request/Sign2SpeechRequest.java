package com.ssafy.backend.domain.translation.controller.request;

import com.ssafy.backend.domain.translation.service.request.Sign2SpeechServiceRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class Sign2SpeechRequest {

    @NotBlank(message = "type must not be blank.")
    private String type;

    @Valid
    @NotEmpty(message = "frames must not be empty.")
    private List<MediaPipeFrameRequest> frames;

    public Sign2SpeechServiceRequest toServiceRequest() {
        return Sign2SpeechServiceRequest.builder()
                .type(type)
                .frames(frames.stream().map(MediaPipeFrameRequest::toServiceRequest).toList())
                .build();
    }
}
