package com.ssafy.backend.domain.translation.controller.request;

import com.ssafy.backend.domain.translation.service.request.MediaPipeFrameServiceRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import java.util.Collections;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class MediaPipeFrameRequest {

    @Valid
    private List<LandmarkRequest> poseLandmarks;

    @Valid
    private List<LandmarkRequest> leftHandLandmarks;

    @Valid
    private List<LandmarkRequest> rightHandLandmarks;

    @Valid
    private List<LandmarkRequest> faceLandmarks;

    @Min(value = 1, message = "videoWidth must be greater than or equal to 1.")
    private Integer videoWidth;

    @Min(value = 1, message = "videoHeight must be greater than or equal to 1.")
    private Integer videoHeight;

    public MediaPipeFrameServiceRequest toServiceRequest() {
        return MediaPipeFrameServiceRequest.builder()
                .poseLandmarks(toServiceRequests(poseLandmarks))
                .leftHandLandmarks(toServiceRequests(leftHandLandmarks))
                .rightHandLandmarks(toServiceRequests(rightHandLandmarks))
                .faceLandmarks(toServiceRequests(faceLandmarks))
                .videoWidth(videoWidth)
                .videoHeight(videoHeight)
                .build();
    }

    private List<com.ssafy.backend.domain.translation.service.request.LandmarkServiceRequest> toServiceRequests(
            List<LandmarkRequest> requests
    ) {
        if (requests == null) {
            return Collections.emptyList();
        }

        return requests.stream()
                .map(LandmarkRequest::toServiceRequest)
                .toList();
    }
}
