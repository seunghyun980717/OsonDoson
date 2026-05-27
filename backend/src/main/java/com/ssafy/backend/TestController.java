package com.ssafy.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

@RestController
public class TestController {

    @Value("${sign2speech.fastapi.base-url}")
    private String fastapiBaseUrl;

    @GetMapping("/test-ai")
    public String testAI() {
        RestTemplate restTemplate = new RestTemplate();
        return restTemplate.getForObject(fastapiBaseUrl + "/health", String.class);
    }
}