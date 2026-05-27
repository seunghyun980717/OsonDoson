package com.ssafy.backend.global.config.restclient;

import com.ssafy.backend.global.client.translation.TranslationProperties;
import java.net.http.HttpClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
@RequiredArgsConstructor
@Slf4j
public class RestClientConfig {

    private final TranslationProperties translationProperties;

    @Bean
    public RestClient translationRestClient(RestClient.Builder builder) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .build();

        return builder
                .baseUrl(translationProperties.getBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory(httpClient))
                .requestInterceptor(loggingInterceptor())
                .build();
    }

    private ClientHttpRequestInterceptor loggingInterceptor() {
        return (request, body, execution) -> {
            long startAt = System.currentTimeMillis();
            String method = request.getMethod().name();
            String url = request.getURI().toString();

            log.info("FastAPI request start. method={}, url={}", method, url);

            ClientHttpResponse response = execute(request, body, execution);
            long elapsedMs = System.currentTimeMillis() - startAt;

            log.info(
                    "FastAPI request complete. method={}, url={}, status={}, elapsedMs={}",
                    method,
                    url,
                    response.getStatusCode().value(),
                    elapsedMs
            );

            return response;
        };
    }

    private ClientHttpResponse execute(
            HttpRequest request,
            byte[] body,
            ClientHttpRequestExecution execution
    ) throws java.io.IOException {
        return execution.execute(request, body);
    }
}
