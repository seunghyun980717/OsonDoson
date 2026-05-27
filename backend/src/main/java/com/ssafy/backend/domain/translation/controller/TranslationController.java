package com.ssafy.backend.domain.translation.controller;

import com.ssafy.backend.domain.translation.controller.request.Sign2SpeechRequest;
import com.ssafy.backend.domain.translation.controller.request.Speech2SignTextRequest;
import com.ssafy.backend.domain.translation.controller.request.GlossesToSpeechRequest;
import com.ssafy.backend.domain.translation.controller.response.Sign2SpeechResponse;
import com.ssafy.backend.domain.translation.controller.response.Speech2SignResponse;
import com.ssafy.backend.domain.translation.service.TranslationService;
import com.ssafy.backend.domain.translation.service.request.Speech2SignServiceRequest;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Speech2SignServiceResponse;
import com.ssafy.backend.global.response.ApiResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/translation")
@RequiredArgsConstructor
@Slf4j
public class TranslationController {

    private final TranslationService translationService;

    @PostMapping("/sign-to-speech")
    public ResponseEntity<ApiResponse<Sign2SpeechResponse>> sign2speech(
            @RequestBody @Valid Sign2SpeechRequest request
    ) {
        int frameCount = request.getFrames() != null ? request.getFrames().size() : 0;
        long startAt = System.currentTimeMillis();

        log.info("sign-to-speech 요청 수신 - type={}, frameCount={}", request.getType(), frameCount);

        Sign2SpeechServiceResponse serviceResponse = translationService.sign2speech(request.toServiceRequest());

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        boolean hasAudio = serviceResponse.getAudioUrl() != null && !serviceResponse.getAudioUrl().isBlank();

        log.info("sign-to-speech 응답 반환 - type={}, glossCount={}, hasAudio={}, elapsedMs={}",
                serviceResponse.getType(),
                glossCount,
                hasAudio,
                elapsedMs);

        return ResponseEntity.ok(ApiResponse.success(Sign2SpeechResponse.from(serviceResponse)));
    }

    @PostMapping(value = "/speech-to-sign", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<Speech2SignResponse>> speech2sign(
            @RequestPart("file") MultipartFile file
    ) throws IOException {
        long startAt = System.currentTimeMillis();
        String fileName = file.getOriginalFilename();
        String contentType = file.getContentType();
        long audioSize = file.getSize();

        log.info("speech-to-sign 요청 수신 - fileName={}, contentType={}, audioSize={}",
                fileName,
                contentType,
                audioSize);

        Speech2SignServiceRequest serviceRequest = Speech2SignServiceRequest.builder()
                .fileName(fileName)
                .contentType(contentType)
                .audioBytes(file.getBytes())
                .build();

        Speech2SignServiceResponse serviceResponse = translationService.speech2sign(serviceRequest);

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        Object frames = serviceResponse.getKeypointPayload() != null
                ? serviceResponse.getKeypointPayload().get("frames")
                : null;
        int frameCount = frames instanceof List<?> frameList ? frameList.size() : 0;

        log.info("speech-to-sign 응답 반환 - glossCount={}, frameCount={}, elapsedMs={}",
                glossCount,
                frameCount,
                elapsedMs);

        return ResponseEntity.ok(ApiResponse.success(Speech2SignResponse.from(serviceResponse)));
    }

    @PostMapping("/text-to-sign")
    public ResponseEntity<ApiResponse<Speech2SignResponse>> text2sign(
            @RequestBody @Valid Speech2SignTextRequest request
    ) {
        long startAt = System.currentTimeMillis();
        log.info("text-to-sign request received - textLength={}",
                request.getText() != null ? request.getText().length() : 0);

        Speech2SignServiceResponse serviceResponse = translationService.text2sign(request.toServiceRequest());

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        Object frames = serviceResponse.getKeypointPayload() != null
                ? serviceResponse.getKeypointPayload().get("frames")
                : null;
        int frameCount = frames instanceof List<?> frameList ? frameList.size() : 0;

        log.info("text-to-sign response returned - glossCount={}, frameCount={}, elapsedMs={}",
                glossCount,
                frameCount,
                elapsedMs);

        return ResponseEntity.ok(ApiResponse.success(Speech2SignResponse.from(serviceResponse)));
    }

    @PostMapping("/glosses-to-speech")
    public ResponseEntity<ApiResponse<Sign2SpeechResponse>> glossesToSpeech(
            @RequestBody @Valid GlossesToSpeechRequest request
    ) {
        int glossCount = request.getGlosses() != null ? request.getGlosses().size() : 0;
        long startAt = System.currentTimeMillis();

        log.info("glosses-to-speech request received - glossCount={}", glossCount);

        Sign2SpeechServiceResponse serviceResponse = translationService.glossesToSpeech(request.toServiceRequest());

        long elapsedMs = System.currentTimeMillis() - startAt;
        boolean hasAudio = serviceResponse.getAudioUrl() != null && !serviceResponse.getAudioUrl().isBlank();

        log.info("glosses-to-speech response returned - glossCount={}, hasAudio={}, elapsedMs={}",
                glossCount,
                hasAudio,
                elapsedMs);

        return ResponseEntity.ok(ApiResponse.success(Sign2SpeechResponse.from(serviceResponse)));
    }
}
