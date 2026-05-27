package com.ssafy.backend.domain.translation.service.request;

import com.ssafy.backend.global.client.translation.request.MediaPipeFrameRequest;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MediaPipeFrameServiceRequest {

    private List<LandmarkServiceRequest> poseLandmarks;
    private List<LandmarkServiceRequest> leftHandLandmarks;
    private List<LandmarkServiceRequest> rightHandLandmarks;
    private List<LandmarkServiceRequest> faceLandmarks;
    private Integer videoWidth;
    private Integer videoHeight;

    public MediaPipeFrameRequest toClientRequest() {
        return MediaPipeFrameRequest.builder()
                .poseLandmarks(toClientRequests(poseLandmarks))
                .leftHandLandmarks(toClientRequests(leftHandLandmarks))
                .rightHandLandmarks(toClientRequests(rightHandLandmarks))
                .faceLandmarks(toClientRequests(faceLandmarks))
                .videoWidth(videoWidth)
                .videoHeight(videoHeight)
                .build();
    }

    private List<com.ssafy.backend.global.client.translation.request.LandmarkRequest> toClientRequests(
            List<LandmarkServiceRequest> requests
    ) {
        if (requests == null) {
            return List.of();
        }

        return requests.stream()
                .map(LandmarkServiceRequest::toClientRequest)
                .toList();
    }
}
