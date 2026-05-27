package com.ssafy.backend.domain.gloss.controller.response;

import com.ssafy.backend.domain.gloss.service.response.GlossRecommendServiceResponse;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GlossRecommendResponse {

    private List<String> recommendations;

    public static GlossRecommendResponse from(GlossRecommendServiceResponse response) {
        return GlossRecommendResponse.builder()
                .recommendations(response.getRecommendations())
                .build();
    }
}
