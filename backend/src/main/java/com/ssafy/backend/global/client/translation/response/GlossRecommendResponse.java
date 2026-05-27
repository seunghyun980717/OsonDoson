package com.ssafy.backend.global.client.translation.response;

import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class GlossRecommendResponse {

    private List<String> recommendations;
}
