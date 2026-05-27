package com.ssafy.backend.domain.translation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;

import com.ssafy.backend.domain.translation.service.response.AudioAssetServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import com.ssafy.backend.global.client.translation.response.AudioAssetResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TranslationAssetServiceTest {

    @Mock
    private TranslationClient translationClient;

    @InjectMocks
    private TranslationAssetService translationAssetService;

    @DisplayName("audio asset 조회가 성공하면 client 응답을 service 응답으로 변환한다")
    @Test
    void getAudioAsset_success() {
        // given
        byte[] body = new byte[]{1, 2, 3, 4};
        AudioAssetResponse clientResponse = AudioAssetResponse.builder()
                .body(body)
                .contentType("audio/mpeg")
                .contentLength(4L)
                .build();
        given(translationClient.getAudioAsset("sample.mp3")).willReturn(clientResponse);

        // when
        AudioAssetServiceResponse response = translationAssetService.getAudioAsset("sample.mp3");

        // then
        assertThat(response.getBody()).containsExactly(1, 2, 3, 4);
        assertThat(response.getContentType()).isEqualTo("audio/mpeg");
        assertThat(response.getContentLength()).isEqualTo(4L);
    }

    @DisplayName("audio asset 조회 중 FastAPI 400 예외가 발생하면 그대로 전파한다")
    @Test
    void getAudioAsset_fastapiBadRequest() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("audio asset 조회 중 FastAPI 인증 예외가 발생하면 그대로 전파한다")
    @Test
    void getAudioAsset_fastapiUnauthorized() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("audio asset 조회 중 FastAPI 404 예외가 발생하면 그대로 전파한다")
    @Test
    void getAudioAsset_fastapiNotFound() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("audio asset 조회 중 FastAPI 5xx 예외가 발생하면 그대로 전파한다")
    @Test
    void getAudioAsset_fastapiServerError() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("audio asset 조회 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파한다")
    @Test
    void getAudioAsset_fastapiConnectionFailed() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        given(translationClient.getAudioAsset("sample.mp3"))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> translationAssetService.getAudioAsset("sample.mp3"))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }
}
