package com.ssafy.backend.global.client.translation.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class Speech2SignResponse {

    private String korean;
    private List<String> glosses;

    @JsonProperty("gloss_str")
    private String glossStr;

    @JsonProperty("keypoint_url")
    private String keypointUrl;

    @JsonProperty("keypoint_path")
    private String keypointPath;

    @JsonProperty("keypoint_payload")
    private Map<String, Object> keypointPayload;

    @JsonProperty("resolved_glosses")
    private List<String> resolvedGlosses;

    @JsonProperty("missing_glosses")
    private List<String> missingGlosses;

    private double coverage;
    private Map<String, Double> timings;
}
