package com.ssafy.backend.domain.gloss.service.response;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GlossRecommendServiceResponse {

    private List<String> recommendations;
}
