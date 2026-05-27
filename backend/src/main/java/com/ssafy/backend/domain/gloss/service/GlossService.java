package com.ssafy.backend.domain.gloss.service;

import com.ssafy.backend.domain.gloss.service.request.GlossRecommendServiceRequest;
import com.ssafy.backend.domain.gloss.service.response.GlossRecommendServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.response.GlossRecommendResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class GlossService {

    private final TranslationClient translationClient;

    public GlossRecommendServiceResponse recommend(GlossRecommendServiceRequest request) {
        List<String> sequence = request.getSequence() != null ? request.getSequence() : List.of();
        long startAt = System.currentTimeMillis();
        log.info("gloss recommend service request start - category={}, sequenceSize={}",
                request.getCategory(),
                sequence.size());

        GlossRecommendResponse response = translationClient.recommendGloss(
                request.getCategory(),
                sequence
        );

        GlossRecommendServiceResponse serviceResponse = GlossRecommendServiceResponse.builder()
                .recommendations(response.getRecommendations())
                .build();

        long elapsedMs = System.currentTimeMillis() - startAt;
        int recommendationCount = serviceResponse.getRecommendations() != null
                ? serviceResponse.getRecommendations().size()
                : 0;
        log.info("gloss recommend service response end - category={}, recommendationCount={}, elapsedMs={}",
                request.getCategory(),
                recommendationCount,
                elapsedMs);

        return serviceResponse;
    }
}
