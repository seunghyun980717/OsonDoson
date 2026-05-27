package com.ssafy.backend.global.client.translation;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Getter
@Setter
@Validated
@ConfigurationProperties(prefix = "sign2speech.fastapi")
public class TranslationProperties {

    @NotBlank
    private String baseUrl;

    @NotBlank
    private String signToSpeechPath;

    @NotBlank
    private String glossesToSpeechPath;

    @NotBlank
    private String audioAssetPath;

    @NotBlank
    private String speechToSignPath;

    @NotBlank
    private String textToSignPath;

    @NotBlank
    private String glossRecommendPath;
}
