package com.ssafy.backend.domain.onehandsign.controller.response;

import com.ssafy.backend.domain.onehandsign.service.response.OneHandSignCreateServiceResponse;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OneHandSignCreateResponse {

    private String id;
    private String gloss;
    private int frameCount;
    private LocalDateTime createdAt;

    public static OneHandSignCreateResponse from(OneHandSignCreateServiceResponse response) {
        return OneHandSignCreateResponse.builder()
                .id(response.getId())
                .gloss(response.getGloss())
                .frameCount(response.getFrameCount())
                .createdAt(response.getCreatedAt())
                .build();
    }
}
