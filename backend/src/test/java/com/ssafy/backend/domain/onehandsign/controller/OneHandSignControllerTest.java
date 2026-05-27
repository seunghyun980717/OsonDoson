package com.ssafy.backend.domain.onehandsign.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.backend.RestControllerTestSupport;
import com.ssafy.backend.domain.onehandsign.service.response.OneHandSignCreateServiceResponse;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class OneHandSignControllerTest extends RestControllerTestSupport {

    @DisplayName("one-hand-sign 생성 요청이 성공하면 저장 결과를 응답한다")
    @Test
    void createOneHandSign_success() throws Exception {
        // given
        OneHandSignCreateServiceResponse serviceResponse = OneHandSignCreateServiceResponse.builder()
                .id("6821f8f5c1234567890abcde")
                .gloss("감사합니다")
                .frameCount(2)
                .createdAt(LocalDateTime.of(2026, 5, 12, 10, 30, 0))
                .build();
        given(oneHandSignService.createOneHandSign(any())).willReturn(serviceResponse);

        // when & then
        mockMvc.perform(post("/api/one-hand-signs")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "gloss": "감사합니다",
                                  "frames": [
                                    {
                                      "leftHandLandmarks": [],
                                      "videoWidth": 1280,
                                      "videoHeight": 720
                                    },
                                    {
                                      "rightHandLandmarks": [],
                                      "videoWidth": 1280,
                                      "videoHeight": 720
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value("SUCCESS"))
                .andExpect(jsonPath("$.message").value("요청이 성공했습니다."))
                .andExpect(jsonPath("$.data.id").value("6821f8f5c1234567890abcde"))
                .andExpect(jsonPath("$.data.gloss").value("감사합니다"))
                .andExpect(jsonPath("$.data.frameCount").value(2))
                .andExpect(jsonPath("$.data.createdAt").value("2026-05-12T10:30:00"));
    }

    @DisplayName("one-hand-sign 생성 요청에서 gloss가 비어 있으면 검증 에러를 반환한다")
    @Test
    void createOneHandSign_blankGloss() throws Exception {
        mockMvc.perform(post("/api/one-hand-signs")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "gloss": "",
                                  "frames": [
                                    {
                                      "videoWidth": 1280,
                                      "videoHeight": 720
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("gloss must not be blank."))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @DisplayName("one-hand-sign 생성 요청에서 frames가 비어 있으면 검증 에러를 반환한다")
    @Test
    void createOneHandSign_emptyFrames() throws Exception {
        mockMvc.perform(post("/api/one-hand-signs")
                        .contentType(APPLICATION_JSON)
                        .content("""
                                {
                                  "gloss": "감사합니다",
                                  "frames": []
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("frames must not be empty."))
                .andExpect(jsonPath("$.data").doesNotExist());
    }
}
