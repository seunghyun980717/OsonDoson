package com.ssafy.backend.domain.onehandsign.controller;

import com.ssafy.backend.domain.onehandsign.controller.request.OneHandSignCreateRequest;
import com.ssafy.backend.domain.onehandsign.controller.response.OneHandSignCreateResponse;
import com.ssafy.backend.domain.onehandsign.service.OneHandSignService;
import com.ssafy.backend.domain.onehandsign.service.response.OneHandSignCreateServiceResponse;
import com.ssafy.backend.global.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/one-hand-signs")
@RequiredArgsConstructor
@Slf4j
public class OneHandSignController {

    private final OneHandSignService oneHandSignService;

    @PostMapping
    public ResponseEntity<ApiResponse<OneHandSignCreateResponse>> createOneHandSign(
            @RequestBody @Valid OneHandSignCreateRequest request
    ) {
        int frameCount = request.getFrames() != null ? request.getFrames().size() : 0;
        long startAt = System.currentTimeMillis();
        log.info("one-hand-sign create request received - gloss={}, frameCount={}",
                request.getGloss(),
                frameCount);

        OneHandSignCreateServiceResponse serviceResponse =
                oneHandSignService.createOneHandSign(request.toServiceRequest());

        long elapsedMs = System.currentTimeMillis() - startAt;
        log.info("one-hand-sign create response returned - id={}, gloss={}, frameCount={}, elapsedMs={}",
                serviceResponse.getId(),
                serviceResponse.getGloss(),
                serviceResponse.getFrameCount(),
                elapsedMs);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(OneHandSignCreateResponse.from(serviceResponse)));
    }
}
