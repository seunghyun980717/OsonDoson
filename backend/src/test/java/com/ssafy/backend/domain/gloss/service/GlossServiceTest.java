package com.ssafy.backend.domain.gloss.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.backend.domain.gloss.service.request.GlossRecommendServiceRequest;
import com.ssafy.backend.domain.gloss.service.response.GlossRecommendServiceResponse;
import com.ssafy.backend.global.client.translation.TranslationClient;
import com.ssafy.backend.global.client.translation.exception.TranslationClientErrorCode;
import com.ssafy.backend.global.client.translation.exception.TranslationClientException;
import com.ssafy.backend.global.client.translation.response.GlossRecommendResponse;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class GlossServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Mock
    private TranslationClient translationClient;

    @InjectMocks
    private GlossService glossService;

    @DisplayName("gloss recommend 호출이 성공하면 FastAPI 응답을 Service 응답으로 변환한다")
    @Test
    void recommend_success() throws Exception {
        // given
        GlossRecommendServiceRequest request = GlossRecommendServiceRequest.builder()
                .category("병원")
                .sequence(List.of("나", "머리"))
                .build();
        GlossRecommendResponse clientResponse = readResponse("""
                {
                  "recommendations": ["아프다", "많이", "심하다", "어디", "약", "없다", "느낌", "때(시간)"]
                }
                """);
        given(translationClient.recommendGloss("병원", List.of("나", "머리")))
                .willReturn(clientResponse);

        // when
        GlossRecommendServiceResponse response = glossService.recommend(request);

        // then
        assertThat(response.getRecommendations())
                .containsExactly("아프다", "많이", "심하다", "어디", "약", "없다", "느낌", "때(시간)");
    }

    @DisplayName("gloss recommend 호출 중 FastAPI 400 예외가 발생하면 그대로 전파한다")
    @Test
    void recommend_fastapiBadRequest() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_BAD_REQUEST);
    }

    @DisplayName("gloss recommend 호출 중 FastAPI 인증 예외가 발생하면 그대로 전파한다")
    @Test
    void recommend_fastapiUnauthorized() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_UNAUTHORIZED);
    }

    @DisplayName("gloss recommend 호출 중 FastAPI 404 예외가 발생하면 그대로 전파한다")
    @Test
    void recommend_fastapiNotFound() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_NOT_FOUND);
    }

    @DisplayName("gloss recommend 호출 중 FastAPI 5xx 예외가 발생하면 그대로 전파한다")
    @Test
    void recommend_fastapiServerError() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_SERVER_ERROR);
    }

    @DisplayName("gloss recommend 호출 중 FastAPI 연결 실패 예외가 발생하면 그대로 전파한다")
    @Test
    void recommend_fastapiConnectionFailed() {
        assertClientExceptionIsPropagated(TranslationClientErrorCode.FASTAPI_CONNECTION_FAILED);
    }

    private void assertClientExceptionIsPropagated(TranslationClientErrorCode errorCode) {
        // given
        GlossRecommendServiceRequest request = GlossRecommendServiceRequest.builder()
                .category("병원")
                .sequence(List.of("나", "머리"))
                .build();
        given(translationClient.recommendGloss("병원", List.of("나", "머리")))
                .willThrow(new TranslationClientException(errorCode));

        // when & then
        assertThatThrownBy(() -> glossService.recommend(request))
                .isInstanceOf(TranslationClientException.class)
                .satisfies(exception -> {
                    TranslationClientException clientException = (TranslationClientException) exception;
                    assertThat(clientException.getErrorCode()).isEqualTo(errorCode);
                    assertThat(clientException.getMessage()).isEqualTo(errorCode.getMessage());
                });
    }

    private GlossRecommendResponse readResponse(String json) throws JsonProcessingException {
        return objectMapper.readValue(json, GlossRecommendResponse.class);
    }
}
