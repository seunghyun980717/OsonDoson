package com.ssafy.backend.domain.translation.service;

import com.ssafy.backend.domain.translation.service.response.AudioAssetServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.response.AudioAssetResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class TranslationAssetService {

    private final TranslationClient translationClient;

    public AudioAssetServiceResponse getAudioAsset(String fileName) {
        long startAt = System.currentTimeMillis();
        log.info("audio asset 조회 요청 수신 - fileName={}", fileName);

        AudioAssetResponse response = translationClient.getAudioAsset(fileName);
        AudioAssetServiceResponse serviceResponse = AudioAssetServiceResponse.from(response);

        long elapsedMs = System.currentTimeMillis() - startAt;
        log.info("audio asset 조회 응답 반환 - fileName={}, contentType={}, contentLength={}, elapsedMs={}",
                fileName,
                serviceResponse.getContentType(),
                serviceResponse.getContentLength(),
                elapsedMs);

        return serviceResponse;
    }
}
