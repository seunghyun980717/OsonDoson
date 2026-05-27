package com.ssafy.backend.domain.translation.service.request;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GlossesToSpeechServiceRequest {

    private List<String> glosses;
}
