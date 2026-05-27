package com.ssafy.backend.domain.translation.controller.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.backend.domain.translation.service.response.Speech2SignServiceResponse;
import java.util.List;
import java.util.Map;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Speech2SignResponse {

    private final String type;
    private final String source;
    private final String korean;
    private final List<String> glosses;

    @JsonProperty("gloss_str")
    private final String glossStr;

    @JsonProperty("keypoint_url")
    private final String keypointUrl;

    @JsonProperty("keypoint_path")
    private final String keypointPath;

    @JsonProperty("keypoint_payload")
    private final Map<String, Object> keypointPayload;

    @JsonProperty("resolved_glosses")
    private final List<String> resolvedGlosses;

    @JsonProperty("missing_glosses")
    private final List<String> missingGlosses;

    private final double coverage;
    private final Map<String, Double> timings;

    public static Speech2SignResponse from(Speech2SignServiceResponse response) {
        return Speech2SignResponse.builder()
                .type(response.getType())
                .source(response.getSource())
                .korean(response.getKorean())
                .glosses(response.getGlosses())
                .glossStr(response.getGlossStr())
                .keypointUrl(response.getKeypointUrl())
                .keypointPath(response.getKeypointPath())
                .keypointPayload(response.getKeypointPayload())
                .resolvedGlosses(response.getResolvedGlosses())
                .missingGlosses(response.getMissingGlosses())
                .coverage(response.getCoverage())
                .timings(response.getTimings())
                .build();
    }
}
