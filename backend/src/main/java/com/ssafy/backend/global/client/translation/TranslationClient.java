package com.ssafy.backend.global.client.translation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import com.ssafy.backend.global.client.translation.request.GlossRecommendRequest;
import com.ssafy.backend.global.client.translation.request.GlossesToSpeechRequest;
import com.ssafy.backend.global.client.translation.request.Sign2SpeechRequest;
import com.ssafy.backend.global.client.translation.request.Speech2SignTextRequest;
import com.ssafy.backend.global.client.translation.response.AudioAssetResponse;
import com.ssafy.backend.global.client.translation.response.FastApiErrorResponse;
import com.ssafy.backend.global.client.translation.response.GlossRecommendResponse;
import com.ssafy.backend.global.client.translation.response.Sign2SpeechResponse;
import com.ssafy.backend.global.client.translation.response.Speech2SignResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

@Component
@Slf4j
@RequiredArgsConstructor
public class TranslationClient {

    private final RestClient translationRestClient;
    private final TranslationProperties properties;
    private final ObjectMapper objectMapper;

    public Sign2SpeechResponse sign2speech(Sign2SpeechRequest request) {
        try {
            return translationRestClient.post()
                    .uri(properties.getSignToSpeechPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI sign2speech client error. status={}",
                                clientResponse.getStatusCode().value());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI sign2speech server error. status={}",
                                clientResponse.getStatusCode().value());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .body(Sign2SpeechResponse.class);
        } catch (ResourceAccessException exception) {
            log.error("FastAPI sign2speech connection failed. message={}", exception.getMessage(), exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    public Speech2SignResponse speech2sign(
            @NonNull String fileName,
            @NonNull String contentType,
            @NonNull byte[] audioBytes
    ) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        HttpHeaders fileHeaders = new HttpHeaders();
        fileHeaders.setContentType(MediaType.parseMediaType(contentType));
        body.add("file", new HttpEntity<>(new NamedByteArrayResource(fileName, audioBytes), fileHeaders));

        try {
            return translationRestClient.post()
                    .uri(properties.getSpeechToSignPath())
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI speech2sign audio client error. status={}, fileName={}",
                                clientResponse.getStatusCode().value(),
                                fileName);
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI speech2sign audio server error. status={}, fileName={}",
                                clientResponse.getStatusCode().value(),
                                fileName);
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .body(Speech2SignResponse.class);
        } catch (ResourceAccessException exception) {
            log.error("FastAPI speech2sign audio connection failed. message={}, fileName={}, contentType={}",
                    exception.getMessage(),
                    fileName,
                    contentType,
                    exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    public Speech2SignResponse text2sign(@NonNull String text) {
        Speech2SignTextRequest request = Speech2SignTextRequest.builder()
                .text(text)
                .build();
        try {
            return translationRestClient.post()
                    .uri(properties.getTextToSignPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI speech2sign text client error. status={}",
                                clientResponse.getStatusCode().value());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI speech2sign text server error. status={}",
                                clientResponse.getStatusCode().value());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .body(Speech2SignResponse.class);
        } catch (ResourceAccessException exception) {
            log.error("FastAPI speech2sign text connection failed. message={}",
                    exception.getMessage(),
                    exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    public Sign2SpeechResponse glossesToSpeech(@NonNull java.util.List<String> glosses) {
        GlossesToSpeechRequest request = GlossesToSpeechRequest.builder()
                .glosses(glosses)
                .build();

        try {
            return translationRestClient.post()
                    .uri(properties.getGlossesToSpeechPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI glosses-to-speech client error. status={}, glossCount={}",
                                clientResponse.getStatusCode().value(),
                                glosses.size());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI glosses-to-speech server error. status={}, glossCount={}",
                                clientResponse.getStatusCode().value(),
                                glosses.size());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .body(Sign2SpeechResponse.class);
        } catch (ResourceAccessException exception) {
            log.error("FastAPI glosses-to-speech connection failed. message={}, glossCount={}",
                    exception.getMessage(),
                    glosses.size(),
                    exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    public AudioAssetResponse getAudioAsset(@NonNull String fileName) {
        try {
            ResponseEntity<byte[]> response = translationRestClient.get()
                    .uri(properties.getAudioAssetPath() + "/{fileName}", fileName)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI audio asset client error. status={}, fileName={}",
                                clientResponse.getStatusCode().value(),
                                fileName);
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI audio asset server error. status={}, fileName={}",
                                clientResponse.getStatusCode().value(),
                                fileName);
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .toEntity(byte[].class);

            return AudioAssetResponse.builder()
                    .body(response.getBody())
                    .contentType(response.getHeaders().getContentType() != null
                            ? response.getHeaders().getContentType().toString()
                            : null)
                    .contentLength(response.getHeaders().getContentLength() >= 0
                            ? response.getHeaders().getContentLength()
                            : null)
                    .build();
        } catch (ResourceAccessException exception) {
            log.error("FastAPI audio asset connection failed. message={}, fileName={}",
                    exception.getMessage(),
                    fileName,
                    exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    public GlossRecommendResponse recommendGloss(@NonNull String category, @NonNull java.util.List<String> sequence) {
        GlossRecommendRequest request = GlossRecommendRequest.builder()
                .category(category)
                .sequence(sequence)
                .build();

        try {
            return translationRestClient.post()
                    .uri(properties.getGlossRecommendPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI gloss recommend client error. status={}, category={}, sequenceSize={}",
                                clientResponse.getStatusCode().value(),
                                category,
                                sequence.size());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (clientRequest, clientResponse) -> {
                        log.error("FastAPI gloss recommend server error. status={}, category={}, sequenceSize={}",
                                clientResponse.getStatusCode().value(),
                                category,
                                sequence.size());
                        throw toClientException(clientResponse.getStatusCode(), readResponseBody(clientResponse));
                    })
                    .body(GlossRecommendResponse.class);
        } catch (ResourceAccessException exception) {
            log.error("FastAPI gloss recommend connection failed. message={}, category={}, sequenceSize={}",
                    exception.getMessage(),
                    category,
                    sequence.size(),
                    exception);
            throw new TranslationClientException(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
        }
    }

    private TranslationClientException toClientException(HttpStatusCode statusCode, String responseBody) {
        TranslationClientErrorCode fallbackErrorCode = toFallbackErrorCode(statusCode);
        FastApiErrorResponse.ErrorDetail detail = parseErrorDetail(responseBody);

        if (detail == null) {
            return new TranslationClientException(fallbackErrorCode);
        }

        return new TranslationClientException(
                fallbackErrorCode,
                detail.getCode(),
                detail.getMessage(),
                detail.getStatus(),
                detail.getSource(),
                detail.getStage()
        );
    }

    private TranslationClientErrorCode toFallbackErrorCode(HttpStatusCode statusCode) {
        if (statusCode.value() == 400) {
            return TranslationClientErrorCode.FASTAPI_BAD_REQUEST;
        }
        if (statusCode.value() == 401 || statusCode.value() == 403) {
            return TranslationClientErrorCode.FASTAPI_UNAUTHORIZED;
        }
        if (statusCode.value() == 404) {
            return TranslationClientErrorCode.FASTAPI_NOT_FOUND;
        }
        return TranslationClientErrorCode.FASTAPI_SERVER_ERROR;
    }

    private String readResponseBody(org.springframework.http.client.ClientHttpResponse clientResponse) {
        try {
            return StreamUtils.copyToString(clientResponse.getBody(), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            log.warn("FastAPI error response body read failed. message={}", exception.getMessage());
            return "";
        }
    }

    private FastApiErrorResponse.ErrorDetail parseErrorDetail(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return null;
        }

        try {
            FastApiErrorResponse response = objectMapper.readValue(responseBody, FastApiErrorResponse.class);
            return response.getError();
        } catch (IOException exception) {
            log.warn("FastAPI error response body parse failed. body={}, message={}",
                    responseBody,
                    exception.getMessage());
            return null;
        }
    }

    private static final class NamedByteArrayResource extends InputStreamResource {

        private final String fileName;
        private final byte[] audioBytes;

        private NamedByteArrayResource(String fileName, byte[] audioBytes) {
            super(new ByteArrayInputStream(audioBytes));
            this.fileName = fileName;
            this.audioBytes = audioBytes;
        }

        @Override
        public String getFilename() {
            return fileName;
        }

        @Override
        public long contentLength() {
            return audioBytes.length;
        }
    }
}
