package com.ssafy.backend.domain.translation.controller;

import com.ssafy.backend.domain.translation.service.TranslationAssetService;
import com.ssafy.backend.domain.translation.service.response.AudioAssetServiceResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/assets")
@RequiredArgsConstructor
@Slf4j
public class TranslationAssetController {

    private final TranslationAssetService translationAssetService;

    @GetMapping("/audio/{fileName}")
    public ResponseEntity<byte[]> getAudioAsset(
            @PathVariable String fileName
    ) {
        long startAt = System.currentTimeMillis();
        log.info("audio asset 요청 수신 - fileName={}", fileName);

        AudioAssetServiceResponse serviceResponse = translationAssetService.getAudioAsset(fileName);

        long elapsedMs = System.currentTimeMillis() - startAt;
        log.info("audio asset 응답 반환 - fileName={}, contentType={}, contentLength={}, elapsedMs={}",
                fileName,
                serviceResponse.getContentType(),
                serviceResponse.getContentLength(),
                elapsedMs);

        return buildAudioResponse(serviceResponse);
    }

    private ResponseEntity<byte[]> buildAudioResponse(AudioAssetServiceResponse serviceResponse) {
        ResponseEntity.BodyBuilder responseBuilder = ResponseEntity.ok();

        // FastAPI에서 받은 원본 Content-Type을 그대로 내려서 클라이언트가 mp3 같은 파일 형식을 올바르게 해석하게 한다.
        if (serviceResponse.getContentType() != null && !serviceResponse.getContentType().isBlank()) {
            responseBuilder.contentType(MediaType.parseMediaType(serviceResponse.getContentType()));
        }

        // 원본 파일 크기를 함께 내려서 클라이언트가 응답 길이를 알 수 있게 한다.
        if (serviceResponse.getContentLength() != null) {
            responseBuilder.contentLength(serviceResponse.getContentLength());
        }

        return responseBuilder.body(serviceResponse.getBody());
    }
}
