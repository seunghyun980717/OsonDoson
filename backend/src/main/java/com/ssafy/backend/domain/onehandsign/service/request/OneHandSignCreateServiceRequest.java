package com.ssafy.backend.domain.onehandsign.service.request;

import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OneHandSignCreateServiceRequest {

    private String gloss;
    private List<Map<String, Object>> frames;
}
