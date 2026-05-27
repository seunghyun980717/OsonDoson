package com.ssafy.backend.domain.translation.controller.request;

import com.ssafy.backend.domain.translation.service.request.Speech2SignTextServiceRequest;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Speech2SignTextRequest {

    @NotBlank
    private String text;

    public Speech2SignTextServiceRequest toServiceRequest() {
        return Speech2SignTextServiceRequest.builder()
                .text(text)
                .build();
    }
}
