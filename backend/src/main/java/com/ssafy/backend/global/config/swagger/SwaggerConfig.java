package com.ssafy.backend.global.config.swagger;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.examples.Example;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.RequestBody;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.servers.Server;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SwaggerConfig {

    @Bean
    public OpenAPI translationOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("S14P31E104 Translation Backend API")
                        .description("""
                                Spring gateway API for sign-to-speech and speech-to-sign translation.
                                All responses follow the common ApiResponse wrapper.
                                """)
                        .version("v1")
                        .contact(new Contact()
                                .name("S14P31E104 Backend Team")))
                .servers(List.of(
                        new Server()
                                .url("http://localhost:8080")
                                .description("Local development server"),
                        new Server()
                                .url("/")
                                .description("Current deployment server")
                ))
                .components(new Components()
                        .addSchemas("ApiResponse", createApiResponseSchema())
                        .addSchemas("ApiErrorResponse", createApiErrorResponseSchema())
                        .addSchemas("Sign2SpeechApiResponse", createSign2SpeechApiResponseSchema())
                        .addSchemas("Speech2SignApiResponse", createSpeech2SignApiResponseSchema())
                        .addSchemas("Speech2SignAudioRequest", createSpeech2SignAudioRequestSchema())
                        .addResponses("ValidationErrorResponse", createValidationErrorApiResponse())
                        .addResponses("FastApiBadGatewayResponse", createFastApiBadGatewayApiResponse()));
    }

    @Bean
    public OpenApiCustomizer translationOpenApiCustomizer() {
        return openApi -> {
            ensureComponentSchemas(openApi);

            if (openApi.getPaths() == null) {
                return;
            }

            customizeSign2Speech(openApi.getPaths().get("/api/translation/sign-to-speech"));
            customizeSpeech2SignAudio(openApi.getPaths().get("/api/translation/speech-to-sign/audio"));
            customizeSpeech2SignText(openApi.getPaths().get("/api/translation/speech-to-sign/text"));
            customizeAudioAsset(openApi.getPaths().get("/api/assets/audio/{fileName}"));
        };
    }

    private void customizeSign2Speech(PathItem pathItem) {
        if (pathItem == null || pathItem.getPost() == null) {
            return;
        }

        pathItem.getPost()
                .summary("Sign to speech translation")
                .description("Receives a MediaPipe keypoint frame sequence and returns recognized glosses, Korean text, and a proxy audio URL.")
                .requestBody(createSign2SpeechRequestBody())
                .responses(createSign2SpeechResponses());
    }

    private void customizeSpeech2SignAudio(PathItem pathItem) {
        if (pathItem == null || pathItem.getPost() == null) {
            return;
        }

        pathItem.getPost()
                .summary("Speech to sign translation from audio")
                .description("Receives an audio file as multipart/form-data and returns glosses, Korean text, and keypoint payload data.")
                .requestBody(createSpeech2SignAudioRequestBody())
                .responses(createSpeech2SignResponses(
                        "Speech-to-sign translation from audio completed successfully",
                        createSpeech2SignAudioSuccessExample()
                ));
    }

    private void customizeSpeech2SignText(PathItem pathItem) {
        if (pathItem == null || pathItem.getPost() == null) {
            return;
        }

        pathItem.getPost()
                .summary("Speech to sign translation from text")
                .description("Receives Korean text as JSON and returns glosses, Korean text, and keypoint payload data.")
                .requestBody(createSpeech2SignTextRequestBody())
                .responses(createSpeech2SignResponses(
                        "Speech-to-sign translation from text completed successfully",
                        createSpeech2SignTextSuccessExample()
                ));
    }

    private void customizeAudioAsset(PathItem pathItem) {
        if (pathItem == null || pathItem.getGet() == null) {
            return;
        }

        pathItem.getGet()
                .summary("Get generated audio asset")
                .description("Returns the generated mp3 audio file through the Spring proxy endpoint.")
                .parameters(List.of(new Parameter()
                        .name("fileName")
                        .in("path")
                        .required(true)
                        .description("Generated audio file name")
                        .schema(new Schema<String>().type("string").example("59c4857720354182a2dbc00fe9dcb83c.mp3"))))
                .responses(createAudioAssetResponses());
    }

    private void ensureComponentSchemas(OpenAPI openApi) {
        if (openApi.getComponents() == null) {
            openApi.setComponents(new Components());
        }

        Map<String, Schema> schemas = openApi.getComponents().getSchemas();
        if (schemas == null) {
            openApi.getComponents().setSchemas(new LinkedHashMap<>());
            schemas = openApi.getComponents().getSchemas();
        }

        schemas.putIfAbsent("ApiResponse", createApiResponseSchema());
        schemas.putIfAbsent("ApiErrorResponse", createApiErrorResponseSchema());
        schemas.putIfAbsent("Sign2SpeechApiResponse", createSign2SpeechApiResponseSchema());
        schemas.putIfAbsent("Speech2SignApiResponse", createSpeech2SignApiResponseSchema());
        schemas.putIfAbsent("Speech2SignAudioRequest", createSpeech2SignAudioRequestSchema());

        if (openApi.getComponents().getResponses() == null) {
            openApi.getComponents().setResponses(new LinkedHashMap<>());
        }
        openApi.getComponents().getResponses()
                .putIfAbsent("ValidationErrorResponse", createValidationErrorApiResponse());
        openApi.getComponents().getResponses()
                .putIfAbsent("FastApiBadGatewayResponse", createFastApiBadGatewayApiResponse());
    }

    private RequestBody createSign2SpeechRequestBody() {
        return new RequestBody()
                .required(true)
                .description("MediaPipe keypoint sequence for sign-to-speech translation")
                .content(new Content().addMediaType(
                        org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                        new MediaType()
                                .schema(new Schema<>().$ref("#/components/schemas/Sign2SpeechRequest"))
                                .addExamples("default", new Example().value(createSign2SpeechRequestExample()))
                ));
    }

    private RequestBody createSpeech2SignAudioRequestBody() {
        return new RequestBody()
                .required(true)
                .description("Audio upload for speech-to-sign translation")
                .content(new Content().addMediaType(
                        org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE,
                        new MediaType()
                                .schema(new Schema<>().$ref("#/components/schemas/Speech2SignAudioRequest"))
                                .addExamples("default", new Example().value(createSpeech2SignAudioRequestExample()))
                ));
    }

    private RequestBody createSpeech2SignTextRequestBody() {
        return new RequestBody()
                .required(true)
                .description("Korean text input for speech-to-sign translation")
                .content(new Content().addMediaType(
                        org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                        new MediaType()
                                .schema(new Schema<>().$ref("#/components/schemas/Speech2SignTextRequest"))
                                .addExamples("default", new Example().value(createSpeech2SignTextRequestExample()))
                ));
    }

    private ApiResponses createSign2SpeechResponses() {
        return new ApiResponses()
                .addApiResponse("200", new ApiResponse()
                        .description("Sign-to-speech translation completed successfully")
                        .content(new Content().addMediaType(
                                org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                                new MediaType()
                                        .schema(new Schema<>().$ref("#/components/schemas/Sign2SpeechApiResponse"))
                                        .addExamples("success", new Example().value(createSign2SpeechSuccessExample()))
                        )))
                .addApiResponse("400", new ApiResponse().$ref("#/components/responses/ValidationErrorResponse"))
                .addApiResponse("502", new ApiResponse().$ref("#/components/responses/FastApiBadGatewayResponse"));
    }

    private ApiResponses createSpeech2SignResponses(String successDescription, Map<String, Object> successExample) {
        return new ApiResponses()
                .addApiResponse("200", new ApiResponse()
                        .description(successDescription)
                        .content(new Content().addMediaType(
                                org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                                new MediaType()
                                        .schema(new Schema<>().$ref("#/components/schemas/Speech2SignApiResponse"))
                                        .addExamples("success", new Example().value(successExample))
                        )))
                .addApiResponse("400", new ApiResponse().$ref("#/components/responses/ValidationErrorResponse"))
                .addApiResponse("502", new ApiResponse().$ref("#/components/responses/FastApiBadGatewayResponse"));
    }

    private ApiResponses createAudioAssetResponses() {
        return new ApiResponses()
                .addApiResponse("200", new ApiResponse()
                        .description("Generated audio file returned successfully")
                        .content(new Content().addMediaType(
                                "audio/mpeg",
                                new MediaType()
                                        .schema(new Schema<String>()
                                                .type("string")
                                                .format("binary"))
                        )))
                .addApiResponse("502", new ApiResponse().$ref("#/components/responses/FastApiBadGatewayResponse"));
    }

    private Schema<?> createApiResponseSchema() {
        return new ObjectSchema()
                .addProperty("code", new Schema<String>()
                        .type("string")
                        .example("SUCCESS")
                        .description("Application-level result code"))
                .addProperty("message", new Schema<String>()
                        .type("string")
                        .example("요청이 성공했습니다.")
                        .description("Human-readable result message"))
                .addProperty("data", new ObjectSchema()
                        .nullable(true)
                        .description("Response payload"));
    }

    private Schema<?> createApiErrorResponseSchema() {
        return new ObjectSchema()
                .addProperty("code", new Schema<String>()
                        .type("string")
                        .example("VALIDATION_ERROR")
                        .description("Application-level error code"))
                .addProperty("message", new Schema<String>()
                        .type("string")
                        .example("입력값이 올바르지 않습니다.")
                        .description("Error message"))
                .addProperty("data", new ObjectSchema()
                        .nullable(true)
                        .example(null)
                        .description("Always null for error responses"));
    }

    private Schema<?> createSign2SpeechApiResponseSchema() {
        return new ObjectSchema()
                .addProperty("code", new Schema<String>()
                        .type("string")
                        .example("SUCCESS"))
                .addProperty("message", new Schema<String>()
                        .type("string")
                        .example("요청이 성공했습니다."))
                .addProperty("data", new Schema<>().$ref("#/components/schemas/Sign2SpeechResponse"));
    }

    private Schema<?> createSpeech2SignApiResponseSchema() {
        return new ObjectSchema()
                .addProperty("code", new Schema<String>()
                        .type("string")
                        .example("SUCCESS"))
                .addProperty("message", new Schema<String>()
                        .type("string")
                        .example("요청이 성공했습니다."))
                .addProperty("data", new Schema<>().$ref("#/components/schemas/Speech2SignResponse"));
    }

    private Schema<?> createSpeech2SignAudioRequestSchema() {
        return new ObjectSchema()
                .addProperty("file", new Schema<String>()
                        .type("string")
                        .format("binary")
                        .description("Audio file uploaded as multipart/form-data"));
    }

    private ApiResponse createValidationErrorApiResponse() {
        return new ApiResponse()
                .description("Validation error response")
                .content(new Content().addMediaType(
                        org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                        new MediaType()
                                .schema(new Schema<>().$ref("#/components/schemas/ApiErrorResponse"))
                                .addExamples("validation", new Example().value(createValidationErrorExample("입력값이 올바르지 않습니다.")))
                ));
    }

    private ApiResponse createFastApiBadGatewayApiResponse() {
        return new ApiResponse()
                .description("FastAPI translation server error")
                .content(new Content().addMediaType(
                        org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                        new MediaType()
                                .schema(new Schema<>().$ref("#/components/schemas/ApiErrorResponse"))
                                .addExamples("fastapi", new Example().value(createFastApiErrorExample()))
                ));
    }

    private Map<String, Object> createSign2SpeechRequestExample() {
        Map<String, Object> landmark = new LinkedHashMap<>();
        landmark.put("x", 0.5);
        landmark.put("y", 0.18);
        landmark.put("z", 0.0);
        landmark.put("visibility", 0.99);

        Map<String, Object> frame = new LinkedHashMap<>();
        frame.put("poseLandmarks", List.of(landmark));
        frame.put("leftHandLandmarks", List.of(landmark));
        frame.put("rightHandLandmarks", List.of(landmark));
        frame.put("faceLandmarks", List.of());
        frame.put("videoWidth", 1280);
        frame.put("videoHeight", 720);

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("type", "signer_keypoints");
        request.put("frames", List.of(frame));
        return request;
    }

    private Map<String, Object> createSpeech2SignAudioRequestExample() {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("file", "(binary audio/webm file)");
        return request;
    }

    private Map<String, Object> createSpeech2SignTextRequestExample() {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("text", "어디로 가고 싶으세요?");
        return request;
    }

    private Map<String, Object> createSign2SpeechSuccessExample() {
        Map<String, Object> audio = new LinkedHashMap<>();
        audio.put("format", "mp3");
        audio.put("content_type", "audio/mpeg");
        audio.put("url", "/api/assets/audio/59c4857720354182a2dbc00fe9dcb83c.mp3");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", "sign_to_speech_result");
        data.put("source", "signer");
        data.put("glosses", List.of("주스"));
        data.put("korean", "주스 드시겠습니까?");
        data.put("audio_url", "/api/assets/audio/59c4857720354182a2dbc00fe9dcb83c.mp3");
        data.put("audio", audio);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", "SUCCESS");
        response.put("message", "요청이 성공했습니다.");
        response.put("data", data);
        return response;
    }

    private Map<String, Object> createSpeech2SignAudioSuccessExample() {
        Map<String, Object> keypointPayload = new LinkedHashMap<>();
        keypointPayload.put("version", "sign-sentence-keypoints/v1");
        keypointPayload.put("frames", List.of(createSpeech2SignFrameExample()));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", "speech_to_sign_result");
        data.put("source", "hearing");
        data.put("korean", "어디로 가고 싶으세요?");
        data.put("glosses", List.of("화장실", "가다", "원하다"));
        data.put("gloss_str", "화장실 가다 원하다");
        data.put("keypoint_url", "/static/json/abc123.json");
        data.put("keypoint_path", "/app/static/json/abc123.json");
        data.put("keypoint_payload", keypointPayload);
        data.put("resolved_glosses", List.of());
        data.put("missing_glosses", List.of("화장실", "가다", "원하다"));
        data.put("coverage", 0.0);
        data.put("timings", Map.of("stt", 0.52, "korean_to_gloss", 0.12));

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", "SUCCESS");
        response.put("message", "요청이 성공했습니다.");
        response.put("data", data);
        return response;
    }

    private Map<String, Object> createSpeech2SignTextSuccessExample() {
        Map<String, Object> keypointPayload = new LinkedHashMap<>();
        keypointPayload.put("version", "sign-sentence-keypoints/v1");
        keypointPayload.put("frames", List.of(createSpeech2SignFrameExample()));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("type", "speech_to_sign_result");
        data.put("source", "hearing");
        data.put("korean", "어디로 가고 싶으세요?");
        data.put("glosses", List.of("화장실", "가다", "원하다"));
        data.put("gloss_str", "화장실 가다 원하다");
        data.put("keypoint_url", "/static/json/abc123.json");
        data.put("keypoint_path", "/app/static/json/abc123.json");
        data.put("keypoint_payload", keypointPayload);
        data.put("resolved_glosses", List.of());
        data.put("missing_glosses", List.of("화장실", "가다", "원하다"));
        data.put("coverage", 0.0);
        data.put("timings", Map.of("korean_to_gloss", 0.12));

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", "SUCCESS");
        response.put("message", "요청이 성공했습니다.");
        response.put("data", data);
        return response;
    }

    private Map<String, Object> createValidationErrorExample(String message) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", "VALIDATION_ERROR");
        response.put("message", message);
        response.put("data", null);
        return response;
    }

    private Map<String, Object> createFastApiErrorExample() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", "FASTAPI_SERVER_ERROR");
        response.put("message", "번역 서버 처리 중 오류가 발생했습니다.");
        response.put("data", null);
        return response;
    }

    private Map<String, Object> createSpeech2SignFrameExample() {
        Map<String, Object> posePoint = new LinkedHashMap<>();
        posePoint.put("x", 0.5);
        posePoint.put("y", 0.18);
        posePoint.put("z", 0.0);

        Map<String, Object> leftHandPoint = new LinkedHashMap<>();
        leftHandPoint.put("x", 0.35);
        leftHandPoint.put("y", 0.50);
        leftHandPoint.put("z", 0.0);

        Map<String, Object> rightHandPoint = new LinkedHashMap<>();
        rightHandPoint.put("x", 0.65);
        rightHandPoint.put("y", 0.50);
        rightHandPoint.put("z", 0.0);

        Map<String, Object> frame = new LinkedHashMap<>();
        frame.put("frame_index", 0);
        frame.put("pose", List.of(posePoint));
        frame.put("left_hand", List.of(leftHandPoint));
        frame.put("right_hand", List.of(rightHandPoint));
        return frame;
    }
}
