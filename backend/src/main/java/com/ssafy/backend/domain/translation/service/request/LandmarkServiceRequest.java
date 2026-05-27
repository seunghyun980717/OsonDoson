package com.ssafy.backend.domain.translation.service.request;

import com.ssafy.backend.global.client.translation.request.LandmarkRequest;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LandmarkServiceRequest {

    private double x;
    private double y;
    private double z;
    private Double visibility;

    public LandmarkRequest toClientRequest() {
        return LandmarkRequest.builder()
                .x(x)
                .y(y)
                .z(z)
                .visibility(visibility)
                .build();
    }
}
