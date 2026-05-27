package com.ssafy.backend.domain.translation.service;

import com.ssafy.backend.domain.translation.service.request.Sign2SpeechServiceRequest;
import com.ssafy.backend.domain.translation.service.request.Speech2SignServiceRequest;
import com.ssafy.backend.domain.translation.service.request.Speech2SignTextServiceRequest;
import com.ssafy.backend.domain.translation.service.request.GlossesToSpeechServiceRequest;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechAudioServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Speech2SignServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.response.Sign2SpeechAudioResponse;
import com.ssafy.backend.global.client.translation.response.Sign2SpeechResponse;
import com.ssafy.backend.global.client.translation.response.Speech2SignResponse;
import java.net.URI;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class TranslationService {

    private static final String SPRING_AUDIO_PROXY_BASE_PATH = "/api/assets/audio";

    private final TranslationClient translationClient;

    public Sign2SpeechServiceResponse sign2speech(Sign2SpeechServiceRequest request) {
        int frameCount = request.getFrames() != null ? request.getFrames().size() : 0;
        long startAt = System.currentTimeMillis();
        log.info("sign-to-speech service 요청 시작 - type={}, frameCount={}", request.getType(), frameCount);

        Sign2SpeechResponse response = translationClient.sign2speech(request.toClientRequest());
        Sign2SpeechServiceResponse serviceResponse = Sign2SpeechServiceResponse.builder()
                .type(response.getType())
                .source(response.getSource())
                .glosses(response.getGlosses())
                .korean(response.getKorean())
                .audioUrl(toSpringAudioUrl(response.getAudioUrl()))
                .audio(toAudioResponse(response.getAudio()))
                .build();

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        boolean hasAudio = serviceResponse.getAudioUrl() != null && !serviceResponse.getAudioUrl().isBlank();
        log.info("sign-to-speech service 응답 종료 - type={}, glossCount={}, hasAudio={}, elapsedMs={}",
                serviceResponse.getType(),
                glossCount,
                hasAudio,
                elapsedMs);

        return serviceResponse;
    }

    public Speech2SignServiceResponse speech2sign(Speech2SignServiceRequest request) {
        int audioSize = request.getAudioBytes() != null ? request.getAudioBytes().length : 0;
        long startAt = System.currentTimeMillis();
        log.info("speech-to-sign service 요청 시작 - fileName={}, contentType={}, audioSize={}",
                request.getFileName(),
                request.getContentType(),
                audioSize);

        Speech2SignResponse response = translationClient.speech2sign(
                request.getFileName(),
                request.getContentType(),
                request.getAudioBytes()
        );

        Speech2SignServiceResponse serviceResponse = Speech2SignServiceResponse.builder()
                .type("speech_to_sign_result")
                .source("hearing")
                .korean(response.getKorean())
                .glosses(response.getGlosses())
                .glossStr(response.getGlossStr())
                .keypointUrl(response.getKeypointUrl())
                .keypointPath(response.getKeypointPath())
                .keypointPayload(response.getKeypointPayload())
                .resolvedGlosses(response.getResolvedGlosses())
                .missingGlosses(response.getMissingGlosses())
                .coverage(response.getCoverage())
                .timings(response.getTimings())
                .build();

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        int frameCount = extractKeypointFrameCount(serviceResponse.getKeypointPayload());
        log.info("speech-to-sign service 응답 종료 - glossCount={}, frameCount={}, elapsedMs={}",
                glossCount,
                frameCount,
                elapsedMs);

        return serviceResponse;
    }

    public Speech2SignServiceResponse text2sign(Speech2SignTextServiceRequest request) {
        long startAt = System.currentTimeMillis();
        log.info("text-to-sign service request start - textLength={}",
                request.getText() != null ? request.getText().length() : 0);

        Speech2SignResponse response = translationClient.text2sign(request.getText());

        Speech2SignServiceResponse serviceResponse = Speech2SignServiceResponse.builder()
                .type("speech_to_sign_result")
                .source("hearing")
                .korean(response.getKorean())
                .glosses(response.getGlosses())
                .glossStr(response.getGlossStr())
                .keypointUrl(response.getKeypointUrl())
                .keypointPath(response.getKeypointPath())
                .keypointPayload(response.getKeypointPayload())
                .resolvedGlosses(response.getResolvedGlosses())
                .missingGlosses(response.getMissingGlosses())
                .coverage(response.getCoverage())
                .timings(response.getTimings())
                .build();

        long elapsedMs = System.currentTimeMillis() - startAt;
        int glossCount = serviceResponse.getGlosses() != null ? serviceResponse.getGlosses().size() : 0;
        int frameCount = extractKeypointFrameCount(serviceResponse.getKeypointPayload());
        log.info("text-to-sign service response end - glossCount={}, frameCount={}, elapsedMs={}",
                glossCount,
                frameCount,
                elapsedMs);

        return serviceResponse;
    }

    public Sign2SpeechServiceResponse glossesToSpeech(GlossesToSpeechServiceRequest request) {
        List<String> glosses = request.getGlosses() != null ? request.getGlosses() : List.of();
        long startAt = System.currentTimeMillis();
        log.info("glosses-to-speech service request start - glossCount={}", glosses.size());

        Sign2SpeechResponse response = translationClient.glossesToSpeech(glosses);
        Sign2SpeechServiceResponse serviceResponse = Sign2SpeechServiceResponse.builder()
                .type(response.getType())
                .source(response.getSource())
                .glosses(response.getGlosses())
                .korean(response.getKorean())
                .audioUrl(toSpringAudioUrl(response.getAudioUrl()))
                .audio(toAudioResponse(response.getAudio()))
                .build();

        long elapsedMs = System.currentTimeMillis() - startAt;
        boolean hasAudio = serviceResponse.getAudioUrl() != null && !serviceResponse.getAudioUrl().isBlank();
        log.info("glosses-to-speech service response end - glossCount={}, hasAudio={}, elapsedMs={}",
                glosses.size(),
                hasAudio,
                elapsedMs);

        return serviceResponse;
    }

    private Sign2SpeechAudioServiceResponse toAudioResponse(Sign2SpeechAudioResponse response) {
        if (response == null) {
            return null;
        }

        return Sign2SpeechAudioServiceResponse.builder()
                .format(response.getFormat())
                .contentType(response.getContentType())
                .url(toSpringAudioUrl(response.getUrl()))
                .build();
    }

    private String toSpringAudioUrl(String audioUrl) {
        if (audioUrl == null || audioUrl.isBlank()) {
            return audioUrl;
        }

        String path = extractPath(audioUrl);
        String fileName = path.substring(path.lastIndexOf('/') + 1);
        return SPRING_AUDIO_PROXY_BASE_PATH + "/" + fileName;
    }

    private String extractPath(String urlOrPath) {
        if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
            return URI.create(urlOrPath).getPath();
        }
        return urlOrPath;
    }

    private int extractKeypointFrameCount(Map<String, Object> keypointPayload) {
        if (keypointPayload == null) {
            return 0;
        }

        Object frames = keypointPayload.get("frames");
        if (frames instanceof List<?> frameList) {
            return frameList.size();
        }

        return 0;
    }
}
