package com.ssafy.backend.domain.translation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.any;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.backend.domain.translation.service.request.LandmarkServiceRequest;
import com.ssafy.backend.domain.translation.service.request.MediaPipeFrameServiceRequest;
import com.ssafy.backend.domain.translation.service.request.Sign2SpeechServiceRequest;
import com.ssafy.backend.domain.translation.service.request.GlossesToSpeechServiceRequest;
import com.ssafy.backend.domain.translation.service.request.Speech2SignServiceRequest;
import com.ssafy.backend.domain.translation.service.request.Speech2SignTextServiceRequest;
import com.ssafy.backend.domain.translation.service.response.Sign2SpeechServiceResponse;
import com.ssafy.backend.domain.translation.service.response.Speech2SignServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import com.ssafy.backend.global.client.translation.request.Sign2SpeechRequest;
import com.ssafy.backend.global.client.translation.response.Sign2SpeechResponse;
import com.ssafy.backend.global.client.translation.response.Speech2SignResponse;
import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TranslationServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private TranslationClient translationClient;

    @InjectMocks
    private TranslationService translationService;

    @DisplayName("sign2speech 호출이 성공하면 FastAPI 응답을 Service 응답으로 변환하고 audio url을 Spring 경로로 바꾼다")
    @Test
    void sign2speech_success() throws Exception {
        // given
        Sign2SpeechServiceRequest request = createServiceRequest();
        Sign2SpeechResponse clientResponse = readResponse("""
                {
                  "type": "sign_to_speech_result",
                  "source": "signer",
                  "glosses": ["주차"],
                  "korean": "주차하시겠습니까?",
                  "audio_url": "https://runpod.example.com/static/audio/59c485.mp3",
                  "audio": {
                    "format": "mp3",
                    "content_type": "audio/mpeg",
                    "url": "/static/audio/59c485.mp3"
                  }
                }
                """);
        given(translationClient.sign2speech(any(Sign2SpeechRequest.class))).willReturn(clientResponse);

        // when
        Sign2SpeechServiceResponse response = translationService.sign2speech(request);

        // then
        // TranslationClient.sign2speech(...) 호출 시 전달된 실제 요청 객체를 가로채기 위한 captor를 만든다.
        ArgumentCaptor<Sign2SpeechRequest> captor = ArgumentCaptor.forClass(Sign2SpeechRequest.class);
        // mock TranslationClient가 sign2speech(...)를 한 번 호출했는지 검증하고, 그때 넘긴 인자를 captor에 저장한다.
        verify(translationClient).sign2speech(captor.capture());
        // 위에서 저장한 실제 인자 값을 꺼내서 Service DTO -> Client DTO 변환 결과를 검증한다.
        Sign2SpeechRequest capturedRequest = captor.getValue();

        assertThat(capturedRequest.getType()).isEqualTo("signer_keypoints");
        assertThat(capturedRequest.getFrames()).hasSize(1);
        assertThat(capturedRequest.getFrames().get(0).getPoseLandmarks()).hasSize(1);
        assertThat(capturedRequest.getFrames().get(0).getVideoWidth()).isEqualTo(1280);
        assertThat(capturedRequest.getFrames().get(0).getVideoHeight()).isEqualTo(720);

        assertThat(response.getType()).isEqualTo("sign_to_speech_result");
        assertThat(response.getSource()).isEqualTo("signer");
        assertThat(response.getGlosses()).containsExactly("주차");
        assertThat(response.getKorean()).isEqualTo("주차하시겠습니까?");
        assertThat(response.getAudioUrl()).isEqualTo("/api/assets/audio/59c485.mp3");
        assertThat(response.getAudio()).isNotNull();
        assertThat(response.getAudio().getFormat()).isEqualTo("mp3");
        assertThat(response.getAudio().getContentType()).isEqualTo("audio/mpeg");
        assertThat(response.getAudio().getUrl()).isEqualTo("/api/assets/audio/59c485.mp3");
    }

    @DisplayName("sign2speech 호출 중 FastAPI 400 예외가 발생하면 그대로 전파한다")
    @Test
    void sign2speech_fastapiBadRequest() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("sign2speech 호출 중 FastAPI 인증 예외가 발생하면 그대로 전파한다")
    @Test
    void sign2speech_fastapiUnauthorized() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("sign2speech 호출 중 FastAPI 404 예외가 발생하면 그대로 전파한다")
    @Test
    void sign2speech_fastapiNotFound() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("sign2speech 호출 중 FastAPI 5xx 예외가 발생하면 그대로 전파한다")
    @Test
    void sign2speech_fastapiServerError() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("sign2speech 호출 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파한다")
    @Test
    void sign2speech_fastapiConnectionFailed() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("speech2sign 호출이 성공하면 FastAPI 응답을 Service 응답으로 변환한다")
    @Test
    void speech2sign_success() throws Exception {
        // given
        Speech2SignServiceRequest request = Speech2SignServiceRequest.builder()
                .fileName("recording.webm")
                .contentType("audio/webm")
                .audioBytes(new byte[]{1, 2, 3})
                .build();
        Speech2SignResponse clientResponse = readSpeech2SignResponse("""
                {
                  "korean": "어디로 가고 싶으세요?",
                  "glosses": ["화장실", "가다", "원하다"],
                  "gloss_str": "화장실 가다 원하다",
                  "keypoint_url": "/static/json/abc123.json",
                  "keypoint_path": "/app/static/json/abc123.json",
                  "keypoint_payload": {
                    "version": "sign-sentence-keypoints/v1",
                    "frames": [
                      {
                        "frame_index": 0,
                        "pose": [
                          { "x": 0.5, "y": 0.18, "z": 0.0 }
                        ],
                        "left_hand": [],
                        "right_hand": []
                      }
                    ]
                  },
                  "resolved_glosses": [],
                  "missing_glosses": ["화장실", "가다", "원하다"],
                  "coverage": 0.0,
                  "timings": {
                    "stt": 0.52,
                    "korean_to_gloss": 0.12
                  }
                }
                """);
        given(translationClient.speech2sign("recording.webm", "audio/webm", new byte[]{1, 2, 3}))
                .willReturn(clientResponse);

        // when
        Speech2SignServiceResponse response = translationService.speech2sign(request);

        // then
        assertThat(response.getType()).isEqualTo("speech_to_sign_result");
        assertThat(response.getSource()).isEqualTo("hearing");
        assertThat(response.getKorean()).isEqualTo("어디로 가고 싶으세요?");
        assertThat(response.getGlosses()).containsExactly("화장실", "가다", "원하다");
        assertThat(response.getGlossStr()).isEqualTo("화장실 가다 원하다");
        assertThat(response.getKeypointUrl()).isEqualTo("/static/json/abc123.json");
        assertThat(response.getKeypointPath()).isEqualTo("/app/static/json/abc123.json");
        assertThat(response.getResolvedGlosses()).isEmpty();
        assertThat(response.getMissingGlosses()).containsExactly("화장실", "가다", "원하다");
        assertThat(response.getCoverage()).isEqualTo(0.0);
        assertThat(response.getTimings()).containsEntry("stt", 0.52);
        assertThat(response.getKeypointPayload())
                .containsEntry("version", "sign-sentence-keypoints/v1");
        assertThat(response.getKeypointPayload().get("frames")).isInstanceOf(List.class);
    }

    @DisplayName("speech2sign 호출 중 FastAPI 400 예외가 발생하면 그대로 전파한다")
    @Test
    void speech2sign_fastapiBadRequest() {
        assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("speech2sign 호출 중 FastAPI 인증 예외가 발생하면 그대로 전파한다")
    @Test
    void speech2sign_fastapiUnauthorized() {
        assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("speech2sign 호출 중 FastAPI 404 예외가 발생하면 그대로 전파한다")
    @Test
    void speech2sign_fastapiNotFound() {
        assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("speech2sign 호출 중 FastAPI 5xx 예외가 발생하면 그대로 전파한다")
    @Test
    void speech2sign_fastapiServerError() {
        assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("speech2sign 호출 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파한다")
    @Test
    void speech2sign_fastapiConnectionFailed() {
        assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("text2sign 호출이 성공하면 FastAPI 응답을 Service 응답으로 변환한다")
    @Test
    void text2sign_success() throws Exception {
        // given
        Speech2SignTextServiceRequest request = Speech2SignTextServiceRequest.builder()
                .text("어디로 가고 싶으세요?")
                .build();
        Speech2SignResponse clientResponse = readSpeech2SignResponse("""
                {
                  "korean": "어디로 가고 싶으세요?",
                  "glosses": ["화장실", "가다", "원하다"],
                  "gloss_str": "화장실 가다 원하다",
                  "keypoint_url": "/static/json/abc123.json",
                  "keypoint_path": "/app/static/json/abc123.json",
                  "keypoint_payload": {
                    "version": "sign-sentence-keypoints/v1",
                    "frames": [
                      {
                        "frame_index": 0,
                        "pose": [
                          { "x": 0.5, "y": 0.18, "z": 0.0 }
                        ],
                        "left_hand": [],
                        "right_hand": []
                      }
                    ]
                  },
                  "resolved_glosses": [],
                  "missing_glosses": ["화장실", "가다", "원하다"],
                  "coverage": 0.0,
                  "timings": {
                    "korean_to_gloss": 0.12
                  }
                }
                """);
        given(translationClient.text2sign("어디로 가고 싶으세요?")).willReturn(clientResponse);

        // when
        Speech2SignServiceResponse response = translationService.text2sign(request);

        // then
        assertThat(response.getType()).isEqualTo("speech_to_sign_result");
        assertThat(response.getSource()).isEqualTo("hearing");
        assertThat(response.getKorean()).isEqualTo("어디로 가고 싶으세요?");
        assertThat(response.getGlosses()).containsExactly("화장실", "가다", "원하다");
        assertThat(response.getGlossStr()).isEqualTo("화장실 가다 원하다");
        assertThat(response.getKeypointUrl()).isEqualTo("/static/json/abc123.json");
        assertThat(response.getKeypointPath()).isEqualTo("/app/static/json/abc123.json");
        assertThat(response.getResolvedGlosses()).isEmpty();
        assertThat(response.getMissingGlosses()).containsExactly("화장실", "가다", "원하다");
        assertThat(response.getCoverage()).isEqualTo(0.0);
        assertThat(response.getTimings()).containsEntry("korean_to_gloss", 0.12);
        assertThat(response.getKeypointPayload())
                .containsEntry("version", "sign-sentence-keypoints/v1");
        assertThat(response.getKeypointPayload().get("frames")).isInstanceOf(List.class);
    }

    @DisplayName("text2sign 호출 중 FastAPI 400 예외가 발생하면 그대로 전파된다")
    @Test
    void text2sign_fastapiBadRequest() {
        assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("text2sign 호출 중 FastAPI 인증 예외가 발생하면 그대로 전파된다")
    @Test
    void text2sign_fastapiUnauthorized() {
        assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("text2sign 호출 중 FastAPI 404 예외가 발생하면 그대로 전파된다")
    @Test
    void text2sign_fastapiNotFound() {
        assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("text2sign 호출 중 FastAPI 5xx 예외가 발생하면 그대로 전파된다")
    @Test
    void text2sign_fastapiServerError() {
        assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("text2sign 호출 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파된다")
    @Test
    void text2sign_fastapiConnectionFailed() {
        assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    @DisplayName("glossesToSpeech 호출이 성공하면 FastAPI 응답을 Service 응답으로 변환하고 audio url을 Spring 경로로 바꾼다")
    @Test
    void glossesToSpeech_success() throws Exception {
        // given
        GlossesToSpeechServiceRequest request = GlossesToSpeechServiceRequest.builder()
                .glosses(List.of("나", "아프다", "병원"))
                .build();
        Sign2SpeechResponse clientResponse = readResponse("""
                {
                  "type": "sign_to_speech_result",
                  "source": "signer",
                  "glosses": ["나", "아프다", "병원"],
                  "korean": "나는 아파서 병원에 갔다",
                  "audio_url": "/static/audio/3890d41195234b5c9efcbeead41ae7f8.mp3",
                  "audio": {
                    "format": "mp3",
                    "content_type": "audio/mpeg",
                    "url": "/static/audio/3890d41195234b5c9efcbeead41ae7f8.mp3"
                  }
                }
                """);
        given(translationClient.glossesToSpeech(List.of("나", "아프다", "병원")))
                .willReturn(clientResponse);

        // when
        Sign2SpeechServiceResponse response = translationService.glossesToSpeech(request);

        // then
        assertThat(response.getType()).isEqualTo("sign_to_speech_result");
        assertThat(response.getSource()).isEqualTo("signer");
        assertThat(response.getGlosses()).containsExactly("나", "아프다", "병원");
        assertThat(response.getKorean()).isEqualTo("나는 아파서 병원에 갔다");
        assertThat(response.getAudioUrl()).isEqualTo("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3");
        assertThat(response.getAudio()).isNotNull();
        assertThat(response.getAudio().getFormat()).isEqualTo("mp3");
        assertThat(response.getAudio().getContentType()).isEqualTo("audio/mpeg");
        assertThat(response.getAudio().getUrl()).isEqualTo("/api/assets/audio/3890d41195234b5c9efcbeead41ae7f8.mp3");
    }

    @DisplayName("glossesToSpeech 호출 중 FastAPI 400 예외가 발생하면 그대로 전파한다")
    @Test
    void glossesToSpeech_fastapiBadRequest() {
        assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("glossesToSpeech 호출 중 FastAPI 인증 예외가 발생하면 그대로 전파한다")
    @Test
    void glossesToSpeech_fastapiUnauthorized() {
        assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("glossesToSpeech 호출 중 FastAPI 404 예외가 발생하면 그대로 전파한다")
    @Test
    void glossesToSpeech_fastapiNotFound() {
        assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("glossesToSpeech 호출 중 FastAPI 5xx 예외가 발생하면 그대로 전파한다")
    @Test
    void glossesToSpeech_fastapiServerError() {
        assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("glossesToSpeech 호출 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파한다")
    @Test
    void glossesToSpeech_fastapiConnectionFailed() {
        assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        Sign2SpeechServiceRequest request = createServiceRequest();
        given(translationClient.sign2speech(any(Sign2SpeechRequest.class)))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> translationService.sign2speech(request))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }

    private void assertSpeech2SignClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        Speech2SignServiceRequest request = Speech2SignServiceRequest.builder()
                .fileName("recording.webm")
                .contentType("audio/webm")
                .audioBytes(new byte[]{1, 2, 3})
                .build();
        given(translationClient.speech2sign("recording.webm", "audio/webm", new byte[]{1, 2, 3}))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> translationService.speech2sign(request))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }

    private void assertText2SignClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        Speech2SignTextServiceRequest request = Speech2SignTextServiceRequest.builder()
                .text("어디로 가고 싶으세요?")
                .build();
        given(translationClient.text2sign("어디로 가고 싶으세요?"))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> translationService.text2sign(request))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }

    private void assertGlossesToSpeechClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        GlossesToSpeechServiceRequest request = GlossesToSpeechServiceRequest.builder()
                .glosses(List.of("나", "아프다", "병원"))
                .build();
        given(translationClient.glossesToSpeech(List.of("나", "아프다", "병원")))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> translationService.glossesToSpeech(request))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }

    private Sign2SpeechServiceRequest createServiceRequest() {
        LandmarkServiceRequest landmark = LandmarkServiceRequest.builder()
                .x(0.5)
                .y(0.4)
                .z(0.0)
                .visibility(0.99)
                .build();

        MediaPipeFrameServiceRequest frame = MediaPipeFrameServiceRequest.builder()
                .poseLandmarks(List.of(landmark))
                .leftHandLandmarks(List.of(landmark))
                .rightHandLandmarks(List.of(landmark))
                .faceLandmarks(List.of())
                .videoWidth(1280)
                .videoHeight(720)
                .build();

        return Sign2SpeechServiceRequest.builder()
                .type("signer_keypoints")
                .frames(List.of(frame))
                .build();
    }

    private Sign2SpeechResponse readResponse(String json) throws JsonProcessingException {
        return objectMapper.readValue(json, Sign2SpeechResponse.class);
    }

    private Speech2SignResponse readSpeech2SignResponse(String json) throws JsonProcessingException {
        return objectMapper.readValue(json, Speech2SignResponse.class);
    }
}
