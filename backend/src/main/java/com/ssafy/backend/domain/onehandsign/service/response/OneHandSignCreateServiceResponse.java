package com.ssafy.backend.domain.onehandsign.service.response;

import com.ssafy.backend.domain.onehandsign.document.OneHandSignDocument;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OneHandSignCreateServiceResponse {

    private String id;
    private String gloss;
    private int frameCount;
    private LocalDateTime createdAt;

    public static OneHandSignCreateServiceResponse from(OneHandSignDocument document) {
        return OneHandSignCreateServiceResponse.builder()
                .id(document.getId())
                .gloss(document.getGloss())
                .frameCount(document.getFrameCount())
                .createdAt(document.getCreatedAt())
                .build();
    }
}
