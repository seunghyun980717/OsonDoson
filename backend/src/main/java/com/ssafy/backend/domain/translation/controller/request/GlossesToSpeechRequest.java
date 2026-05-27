package com.ssafy.backend.domain.translation.controller.request;

import com.ssafy.backend.domain.translation.service.request.GlossesToSpeechServiceRequest;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class GlossesToSpeechRequest {

    @NotEmpty(message = "glosses must not be empty.")
    private List<String> glosses;

    public GlossesToSpeechServiceRequest toServiceRequest() {
        return GlossesToSpeechServiceRequest.builder()
                .glosses(glosses)
                .build();
    }
}
