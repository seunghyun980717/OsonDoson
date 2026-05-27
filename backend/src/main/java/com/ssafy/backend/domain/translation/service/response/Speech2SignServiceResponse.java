package com.ssafy.backend.domain.translation.service.response;

import java.util.List;
import java.util.Map;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Speech2SignServiceResponse {

    private final String type;
    private final String source;
    private final String korean;
    private final List<String> glosses;
    private final String glossStr;
    private final String keypointUrl;
    private final String keypointPath;
    private final Map<String, Object> keypointPayload;
    private final List<String> resolvedGlosses;
    private final List<String> missingGlosses;
    private final double coverage;
    private final Map<String, Double> timings;
}
