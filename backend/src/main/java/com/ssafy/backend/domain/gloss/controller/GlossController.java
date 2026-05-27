package com.ssafy.backend.domain.gloss.controller;

import com.ssafy.backend.domain.gloss.controller.request.GlossRecommendRequest;
import com.ssafy.backend.domain.gloss.controller.response.GlossRecommendResponse;
import com.ssafy.backend.domain.gloss.service.GlossService;
import com.ssafy.backend.domain.gloss.service.response.GlossRecommendServiceResponse;
import com.ssafy.backend.global.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/glosses")
@RequiredArgsConstructor
@Slf4j
public class GlossController {

    private final GlossService glossService;

    @PostMapping("/recommend")
    public ResponseEntity<ApiResponse<GlossRecommendResponse>> recommend(
            @RequestBody @Valid GlossRecommendRequest request
    ) {
        int sequenceSize = request.getSequence() != null ? request.getSequence().size() : 0;
        long startAt = System.currentTimeMillis();
        log.info("gloss recommend request received - category={}, sequenceSize={}",
                request.getCategory(),
                sequenceSize);

        GlossRecommendServiceResponse serviceResponse = glossService.recommend(request.toServiceRequest());

        long elapsedMs = System.currentTimeMillis() - startAt;
        int recommendationCount = serviceResponse.getRecommendations() != null
                ? serviceResponse.getRecommendations().size()
                : 0;
        log.info("gloss recommend response returned - category={}, recommendationCount={}, elapsedMs={}",
                request.getCategory(),
                recommendationCount,
                elapsedMs);

        return ResponseEntity.ok(ApiResponse.success(GlossRecommendResponse.from(serviceResponse)));
    }
}
