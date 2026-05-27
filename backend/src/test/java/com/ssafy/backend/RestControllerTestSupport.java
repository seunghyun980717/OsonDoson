package com.ssafy.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ssafy.backend.domain.gloss.controller.GlossController;
import com.ssafy.backend.domain.gloss.service.GlossService;
import com.ssafy.backend.domain.onehandsign.controller.OneHandSignController;
import com.ssafy.backend.domain.onehandsign.service.OneHandSignService;
import com.ssafy.backend.domain.translation.controller.TranslationAssetController;
import com.ssafy.backend.domain.translation.controller.TranslationController;
import com.ssafy.backend.domain.translation.service.TranslationAssetService;
import com.ssafy.backend.domain.translation.service.TranslationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = {
        GlossController.class,
        OneHandSignController.class,
        TranslationAssetController.class,
        TranslationController.class
})
public abstract class RestControllerTestSupport {

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @MockitoBean
    protected TranslationService translationService;

    @MockitoBean
    protected TranslationAssetService translationAssetService;

    @MockitoBean
    protected GlossService glossService;

    @MockitoBean
    protected OneHandSignService oneHandSignService;

}
