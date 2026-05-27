package com.ssafy.backend.domain.onehandsign.controller.request;

import com.ssafy.backend.domain.onehandsign.service.request.OneHandSignCreateServiceRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OneHandSignCreateRequest {

    @NotBlank(message = "gloss must not be blank.")
    private String gloss;

    @NotEmpty(message = "frames must not be empty.")
    private List<Map<String, Object>> frames;

    public OneHandSignCreateServiceRequest toServiceRequest() {
        return OneHandSignCreateServiceRequest.builder()
                .gloss(gloss)
                .frames(frames)
                .build();
    }
}
