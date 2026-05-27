package com.ssafy.backend.domain.translation.service.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Speech2SignServiceRequest {

    private String fileName;
    private String contentType;
    private byte[] audioBytes;
}
