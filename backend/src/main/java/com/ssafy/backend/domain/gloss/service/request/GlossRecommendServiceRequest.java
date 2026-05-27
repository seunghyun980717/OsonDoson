package com.ssafy.backend.domain.gloss.service.request;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GlossRecommendServiceRequest {

    private String category;
    private List<String> sequence;
}
