package com.ssafy.backend.domain.translation.controller.request;

import com.ssafy.backend.domain.translation.service.request.LandmarkServiceRequest;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class LandmarkRequest {

    @DecimalMin(value = "-10.0")
    @DecimalMax(value = "10.0")
    private double x;

    @DecimalMin(value = "-10.0")
    @DecimalMax(value = "10.0")
    private double y;

    @DecimalMin(value = "-10.0")
    @DecimalMax(value = "10.0")
    private double z;

    @DecimalMin(value = "0.0")
    @DecimalMax(value = "1.0")
    private Double visibility;

    public LandmarkServiceRequest toServiceRequest() {
        return LandmarkServiceRequest.builder()
                .x(x)
                .y(y)
                .z(z)
                .visibility(visibility)
                .build();
    }
}
