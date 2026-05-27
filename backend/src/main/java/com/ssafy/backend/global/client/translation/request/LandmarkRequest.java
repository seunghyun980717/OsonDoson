package com.ssafy.backend.global.client.translation.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LandmarkRequest {

    private double x;
    private double y;
    private double z;
    private Double visibility;
}
