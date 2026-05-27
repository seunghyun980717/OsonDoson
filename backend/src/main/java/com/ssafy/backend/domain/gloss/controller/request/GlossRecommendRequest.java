package com.ssafy.backend.domain.gloss.controller.request;

import com.ssafy.backend.domain.gloss.service.request.GlossRecommendServiceRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GlossRecommendRequest {

    @NotBlank
    private String category;

    @NotNull
    private List<String> sequence;

    public GlossRecommendServiceRequest toServiceRequest() {
        return GlossRecommendServiceRequest.builder()
                .category(category)
                .sequence(sequence)
                .build();
    }
}
