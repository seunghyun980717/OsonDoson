package com.ssafy.backend.domain.translation.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.backend.RestControllerTestSupport;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechAudioServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Speech2SignServiceResponse;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class TranslationControllerTest extends RestControllerTestSupport {

    @DisplayName("sign-to-speech 요청이 성공하면 변환 결과를 응답한다")
    @Test
    void sign2speech_success() throws Exception {
        // given
        Sign2SpeechServiceResponse serviceResponse = Sign2SpeechServiceResponse.builder()
                .type("sign_to_speech_result")
                .source("signer")
                .glosses(List.of("주스"))
                .korean("주스 드시겠습니까?")
                .audioUrl("/api/assets/audio/59c485.mp3")
                .audio(Sign2SpeechAudioServiceResponse.builder()
                        .format("mp3")
                        .contentType("audio/mpeg")
                        .url("/api/assets/audio/59c485.mp3")
                        .build())
                .build();
        given(translationService.sign2speech(any())).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(post("/api/translation/sign-to-speech")
                        .contentType(APPLICATION_JSON)
                        .content(createValidRequestJson()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.type").value("sign_to_speech_result"))
                .andExpect(jsonPath("$.data.source").value("signer"))
                .andExpect(jsonPath("$.data.glosses[0]").value("주스"))
                .andExpect(jsonPath("$.data.korean").value("주스 드시겠습니까?"))
                .andExpect(jsonPath("$.data.audio_url").value("/api/assets/audio/59c485.mp3"))
                .andExpect(jsonPath("$.data.audio.format").value("mp3"))
                .andExpect(jsonPath("$.data.audio.content_type").value("audio/mpeg"))
                .andExpect(jsonPath("$.data.audio.url").value("/api/assets/audio/59c485.mp3"));
    }

    @DisplayName("speech-to-sign 오디오 요청이 성공하면 변환 결과를 응답한다")
    @Test
    void speech2sign_success() throws Exception {
        // given
        Speech2SignServiceResponse serviceResponse = Speech2SignServiceResponse.builder()
                .type("speech_to_sign_result")
                .source("hearing")
                .korean("어디로 가고 싶으세요?")
                .glosses(List.of("화장실", "가다", "원하다"))
                .glossStr("화장실 가다 원하다")
                .keypointUrl("/static/json/abc123.json")
                .keypointPath("/app/static/json/abc123.json")
                .keypointPayload(Map.of(
                        "version", "sign-sentence-keypoints/v1",
                        "frames", List.of(Map.of("frame_index", 0))
                ))
                .resolvedGlosses(List.of())
                .missingGlosses(List.of("화장실", "가다", "원하다"))
                .coverage(0.0)
                .timings(Map.of("stt", 0.52, "korean_to_gloss", 0.12))
                .build();
        given(translationService.speech2sign(any())).willReturn(serviceResponse);

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "recording.webm",
                "audio/webm",
                new byte[]{1, 2, 3}
        );

        // when & then
        mockMvc.perform(multipart("/api/translation/speech-to-sign")
                        .file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.type").value("speech_to_sign_result"))
                .andExpect(jsonPath("$.data.source").value("hearing"))
                .andExpect(jsonPath("$.data.korean").value("어디로 가고 싶으세요?"))
                .andExpect(jsonPath("$.data.glosses[0]").value("화장실"))
                .andExpect(jsonPath("$.data.gloss_str").value("화장실 가다 원하다"))
                .andExpect(jsonPath("$.data.keypoint_url").value("/static/json/abc123.json"))
                .andExpect(jsonPath("$.data.keypoint_path").value("/app/static/json/abc123.json"))
                .andExpect(jsonPath("$.data.keypoint_payload.version").value("sign-sentence-keypoints/v1"))
                .andExpect(jsonPath("$.data.missing_glosses[0]").value("화장실"))
                .andExpect(jsonPath("$.data.coverage").value(0.0));
    }

    @DisplayName("speech-to-sign 요청에서 file 파트가 없으면 공통 에러 응답을 반환한다")
    @Test
    void speech2sign_missingFilePart() throws Exception {
        mockMvc.perform(multipart("/api/translation/speech-to-sign")
                        .file(new MockMultipartFile(
                                "dummy",
                                "",
                                "text/plain",
                                "value".getBytes()
                        )))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("필수 multipart 파트 'file'가 없습니다."))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void sign2speech_fastapiBadRequest() throws Exception {
        assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 상세 예외가 전달되면 code와 message에 상세값을 담아 반환한다")
    @Test
    void sign2speech_fastapiDetailedError() throws Exception {
        given(translationService.sign2speech(any()))
                .willThrow(new TranslationClientException(
                        TranslationClientErrorCode.FASTAPI_BAD_REQUEST,
                        "FRAME_INPUT_EMPTY",
                        "프레임 입력이 비어 있습니다.",
                        400,
                        "sign_to_speech",
                        "frames_to_speech"
                ));

        mockMvc.perform(post("/api/translation/sign-to-speech")
                        .contentType(APPLICATION_JSON)
                        .content(createValidRequestJson()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("FRAME_INPUT_EMPTY"))
                .andExpect(jsonPath("$.message").value("프레임 입력이 비어 있습니다."))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void sign2speech_fastapiUnauthorized() throws Exception {
        assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void sign2speech_fastapiNotFound() throws Exception {
        assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void sign2speech_fastapiServerError() throws Exception {
        assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("sign-to-speech 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void sign2speech_fastapiConnectionFailed() throws Exception {
        assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("speech-to-sign 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void speech2sign_fastapiBadRequest() throws Exception {
        assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("speech-to-sign 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void speech2sign_fastapiUnauthorized() throws Exception {
        assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("speech-to-sign 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void speech2sign_fastapiNotFound() throws Exception {
        assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("speech-to-sign 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void speech2sign_fastapiServerError() throws Exception {
        assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("speech-to-sign 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void speech2sign_fastapiConnectionFailed() throws Exception {
        assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("text-to-sign 텍스트 요청이 성공하면 변환 결과를 응답한다")
    @Test
    void text2sign_success() throws Exception {
        // given
        Speech2SignServiceResponse serviceResponse = Speech2SignServiceResponse.builder()
                .type("speech_to_sign_result")
                .source("hearing")
                .korean("어디로 가고 싶으세요?")
                .glosses(List.of("화장실", "가다", "원하다"))
                .glossStr("화장실 가다 원하다")
                .keypointUrl("/static/json/abc123.json")
                .keypointPath("/app/static/json/abc123.json")
                .keypointPayload(Map.of(
                        "version", "sign-sentence-keypoints/v1",
                        "frames", List.of(Map.of("frame_index", 0))
                ))
                .resolvedGlosses(List.of())
                .missingGlosses(List.of("화장실", "가다", "원하다"))
                .coverage(0.0)
                .timings(Map.of("korean_to_gloss", 0.12))
                .build();
        given(translationService.text2sign(any())).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(post("/api/translation/text-to-sign")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "text": "어디로 가고 싶으세요?"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.type").value("speech_to_sign_result"))
                .andExpect(jsonPath("$.data.source").value("hearing"))
                .andExpect(jsonPath("$.data.korean").value("어디로 가고 싶으세요?"))
                .andExpect(jsonPath("$.data.glosses[0]").value("화장실"))
                .andExpect(jsonPath("$.data.gloss_str").value("화장실 가다 원하다"))
                .andExpect(jsonPath("$.data.keypoint_url").value("/static/json/abc123.json"))
                .andExpect(jsonPath("$.data.keypoint_path").value("/app/static/json/abc123.json"))
                .andExpect(jsonPath("$.data.keypoint_payload.version").value("sign-sentence-keypoints/v1"))
                .andExpect(jsonPath("$.data.missing_glosses[0]").value("화장실"))
                .andExpect(jsonPath("$.data.coverage").value(0.0));
    }

    @DisplayName("text-to-sign 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void text2sign_fastapiBadRequest() throws Exception {
        assertText2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("text-to-sign 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void text2sign_fastapiUnauthorized() throws Exception {
        assertText2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("text-to-sign 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void text2sign_fastapiNotFound() throws Exception {
        assertText2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("text-to-sign 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void text2sign_fastapiServerError() throws Exception {
        assertText2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("text-to-sign 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void text2sign_fastapiConnectionFailed() throws Exception {
        assertText2SignServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("glosses-to-speech 요청이 성공하면 변환 결과를 응답한다")
    @Test
    void glossesToSpeech_success() throws Exception {
        // given
        Sign2SpeechServiceResponse serviceResponse = Sign2SpeechServiceResponse.builder()
                .type("sign_to_speech_result")
                .source("signer")
                .glosses(List.of("나", "아프다", "병원"))
                .korean("나는 아파서 병원에 갔다")
                .audioUrl("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3")
                .audio(Sign2SpeechAudioServiceResponse.builder()
                        .format("mp3")
                        .contentType("audio/mpeg")
                        .url("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3")
                        .build())
                .build();
        given(translationService.glossesToSpeech(any())).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(post("/api/translation/glosses-to-speech")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "glosses": ["나", "아프다", "병원"]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.type").value("sign_to_speech_result"))
                .andExpect(jsonPath("$.data.source").value("signer"))
                .andExpect(jsonPath("$.data.glosses[0]").value("나"))
                .andExpect(jsonPath("$.data.glosses[1]").value("아프다"))
                .andExpect(jsonPath("$.data.glosses[2]").value("병원"))
                .andExpect(jsonPath("$.data.korean").value("나는 아파서 병원에 갔다"))
                .andExpect(jsonPath("$.data.audio_url")
                        .value("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3"))
                .andExpect(jsonPath("$.data.audio.format").value("mp3"))
                .andExpect(jsonPath("$.data.audio.content_type").value("audio/mpeg"))
                .andExpect(jsonPath("$.data.audio.url")
                        .value("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3"));
    }

    @DisplayName("glosses-to-speech 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void glossesToSpeech_fastapiBadRequest() throws Exception {
        assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("glosses-to-speech 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void glossesToSpeech_fastapiUnauthorized() throws Exception {
        assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("glosses-to-speech 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void glossesToSpeech_fastapiNotFound() throws Exception {
        assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("glosses-to-speech 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void glossesToSpeech_fastapiServerError() throws Exception {
        assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("glosses-to-speech 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void glossesToSpeech_fastapiConnectionFailed() throws Exception {
        assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertSign2SpeechServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(translationService.sign2speech(any()))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        mockMvc.perform(post("/api/translation/sign-to-speech")
                        .contentType(APPLICATION_JSON)
                        .content(createValidRequestJson()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    private void assertSpeech2SignServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(translationService.speech2sign(any()))
                .willThrow(new TranslationClientException(errorCode));

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "recording.webm",
                "audio/webm",
                new byte[]{1, 2, 3}
        );

        // when & then
        mockMvc.perform(multipart("/api/translation/speech-to-sign")
                        .file(file))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    private void assertText2SignServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(translationService.text2sign(any()))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        mockMvc.perform(post("/api/translation/text-to-sign")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "text": "어디로 가고 싶으세요?"
                                }
                                """))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    private void assertGlossesToSpeechServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(translationService.glossesToSpeech(any()))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        mockMvc.perform(post("/api/translation/glosses-to-speech")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "glosses": ["나", "아프다", "병원"]
                                }
                                """))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    private String createValidRequestJson() {
        return """
                {
                  "type": "signer_keypoints",
                  "frames": [
                    {
                      "poseLandmarks": [
                        {
                          "x": 0.5,
                          "y": 0.4,
                          "z": 0.0,
                          "visibility": 0.99
                        }
                      ],
                      "leftHandLandmarks": [
                        {
                          "x": 0.5,
                          "y": 0.4,
                          "z": 0.0,
                          "visibility": 0.99
                        }
                      ],
                      "rightHandLandmarks": [
                        {
                          "x": 0.5,
                          "y": 0.4,
                          "z": 0.0,
                          "visibility": 0.99
                        }
                      ],
                      "faceLandmarks": [],
                      "videoWidth": 1280,
                      "videoHeight": 720
                    }
                  ]
                }
                """;
    }
}
