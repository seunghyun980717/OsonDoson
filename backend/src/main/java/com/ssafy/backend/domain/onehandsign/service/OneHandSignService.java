package com.ssafy.backend.domain.onehandsign.service;

import com.ssafy.backend.domain.onehandsign.document.OneHandSignDocument;
import com.ssafy.backend.domain.onehandsign.exception.OneHandSignErrorCode;
import com.ssafy.backend.domain.onehandsign.exception.OneHandSignException;
import com.ssafy.backend.domain.onehandsign.repository.OneHandSignRepository;
import com.ssafy.backend.domain.onehandsign.service.request.OneHandSignCreateServiceRequest;
import com.ssafy.backend.domain.onehandsign.service.response.OneHandSignCreateServiceResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class OneHandSignService {

    private final OneHandSignRepository oneHandSignRepository;

    public OneHandSignCreateServiceResponse createOneHandSign(OneHandSignCreateServiceRequest request) {
        int frameCount = request.getFrames() != null ? request.getFrames().size() : 0;
        long startAt = System.currentTimeMillis();
        log.info("one-hand-sign create service request start - gloss={}, frameCount={}",
                request.getGloss(),
                frameCount);

        try {
            OneHandSignDocument document = OneHandSignDocument.create(
                    request.getGloss(),
                    request.getFrames()
            );
            OneHandSignDocument savedDocument = oneHandSignRepository.save(document);

            long elapsedMs = System.currentTimeMillis() - startAt;
            log.info("one-hand-sign create service response end - id={}, gloss={}, frameCount={}, elapsedMs={}",
                    savedDocument.getId(),
                    savedDocument.getGloss(),
                    savedDocument.getFrameCount(),
                    elapsedMs);

            return OneHandSignCreateServiceResponse.from(savedDocument);
        } catch (Exception exception) {
            log.error("one-hand-sign create service failed - gloss={}, frameCount={}",
                    request.getGloss(),
                    frameCount,
                    exception);
            throw new OneHandSignException(OneHandSignErrorCode.ONE_HAND_SIGN_SAVE_FAILED);
        }
    }
}
