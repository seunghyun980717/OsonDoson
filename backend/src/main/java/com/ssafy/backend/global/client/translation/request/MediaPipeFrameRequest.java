package com.ssafy.backend.global.client.translation.request;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MediaPipeFrameRequest {

    private List<LandmarkRequest> poseLandmarks;
    private List<LandmarkRequest> leftHandLandmarks;
    private List<LandmarkRequest> rightHandLandmarks;
    private List<LandmarkRequest> faceLandmarks;
    private Integer videoWidth;
    private Integer videoHeight;
}
