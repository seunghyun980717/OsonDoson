package com.ssafy.backend.domain.translation.controller;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.backend.RestControllerTestSupport;
import com.ssafy.backend.domain.translation.service.response.AudioAssetServiceResponse;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class TranslationAssetControllerTest extends RestControllerTestSupport {

    @DisplayName("audio asset 조회가 성공하면 mp3 바이너리와 헤더를 그대로 반환한다")
    @Test
    void getAudioAsset_success() throws Exception {
        // given
        byte[] body = new byte[]{1, 2, 3, 4};
        AudioAssetServiceResponse serviceResponse = AudioAssetServiceResponse.builder()
                .body(body)
                .contentType("audio/mpeg")
                .contentLength(4L)
                .build();
        given(translationAssetService.getAudioAsset("sample.mp3")).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(get("/api/assets/audio/sample.mp3"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "audio/mpeg"))
                .andExpect(header().string("Content-Length", "4"))
                .andExpect(content().bytes(body));
    }

    @DisplayName("audio asset 조회 중 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void getAudioAsset_fastapiBadRequest() throws Exception {
        assertServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("audio asset 조회 중 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void getAudioAsset_fastapiUnauthorized() throws Exception {
        assertServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("audio asset 조회 중 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void getAudioAsset_fastapiNotFound() throws Exception {
        assertServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("audio asset 조회 중 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void getAudioAsset_fastapiServerError() throws Exception {
        assertServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("audio asset 조회 중 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void getAudioAsset_fastapiConnectionFailed() throws Exception {
        assertServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(translationAssetService.getAudioAsset("sample.mp3"))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        mockMvc.perform(get("/api/assets/audio/sample.mp3"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }
}
