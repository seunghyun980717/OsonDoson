package com.ssafy.backend.domain.gloss.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.backend.RestControllerTestSupport;
import com.ssafy.backend.domain.gloss.service.response.GlossRecommendServiceResponse;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class GlossControllerTest extends RestControllerTestSupport {

    @DisplayName("gloss recommend 요청이 성공하면 추천 결과를 응답한다")
    @Test
    void recommend_success() throws Exception {
        // given
        GlossRecommendServiceResponse serviceResponse = GlossRecommendServiceResponse.builder()
                .recommendations(List.of("아프다", "많이", "심하다", "어디", "약", "없다", "느낌", "때(시간)"))
                .build();
        given(glossService.recommend(any())).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(post("/api/glosses/recommend")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "category": "병원",
                                  "sequence": ["나", "머리"]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.recommendations[0]").value("아프다"))
                .andExpect(jsonPath("$.data.recommendations[1]").value("많이"))
                .andExpect(jsonPath("$.data.recommendations[7]").value("때(시간)"));
    }

    @DisplayName("gloss recommend 서비스에서 FastAPI 400 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void recommend_fastapiBadRequest() throws Exception {
        assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("gloss recommend 서비스에서 FastAPI 인증 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void recommend_fastapiUnauthorized() throws Exception {
        assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("gloss recommend 서비스에서 FastAPI 404 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void recommend_fastapiNotFound() throws Exception {
        assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("gloss recommend 서비스에서 FastAPI 5xx 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void recommend_fastapiServerError() throws Exception {
        assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("gloss recommend 서비스에서 FastAPI 연결 실패 예외가 발생하면 BAD_GATEWAY 응답을 반환한다")
    @Test
    void recommend_fastapiConnectionFailed() throws Exception {
        assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertGlossRecommendServiceExceptionResponse(TranslationClientErrorCode errorCode) throws Exception {
        // given
        given(glossService.recommend(any()))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        mockMvc.perform(post("/api/glosses/recommend")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "category": "병원",
                                  "sequence": ["나", "머리"]
                                }
                                """))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(errorCode.name()))
                .andExpect(jsonPath("$.message").value(errorCode.getMessage()))
                .andExpect(jsonPath("$.data").doesNotExist());
    }
}
