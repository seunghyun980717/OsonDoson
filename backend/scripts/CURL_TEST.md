# CURL_TEST

`/Users/joonwan/S14P31E104/backend/scripts/curl_test.txt` 실행 결과를 시나리오별로 정리한 문서입니다.
긴 응답 본문은 가독성을 위해 앞부분 10줄 정도만 남기고 `...`로 축약했습니다.

## 실행 환경

- 테스트 실행 시각: `2026-05-10 15:24:49 KST`
- Backend base URL: `http://localhost:8080`
- Audio sample: `/Users/joonwan/S14P31E104/backend/test-client/sample.wav`
- 총 시나리오 수: `11`

## 요약

| 시나리오 | 결과 | HTTP | 응답시간 | 응답 코드 |
|---|---:|---:|---:|---|
| sign-to-speech success | 실패 | 502 | 145.6 ms | `GLOSS_SEQUENCE_GENERATION_FAILED` |
| sign-to-speech spring validation error | 실패 | 400 | 4.3 ms | `VALIDATION_ERROR` |
| speech-to-sign audio success | 성공 | 200 | 1102.0 ms | `SUCCESS` |
| speech-to-sign missing file validation error | 실패 | 400 | 2.6 ms | `VALIDATION_ERROR` |
| text-to-sign success | 성공 | 200 | 166.2 ms | `SUCCESS` |
| text-to-sign spring validation error | 실패 | 400 | 6.3 ms | `VALIDATION_ERROR` |
| glosses-to-speech success | 성공 | 200 | 496.5 ms | `SUCCESS` |
| glosses-to-speech spring validation error | 실패 | 400 | 1.9 ms | `VALIDATION_ERROR` |
| glosses-to-speech fastapi detailed error | 실패 | 502 | 3.1 ms | `GLOSS_LIST_EMPTY` |
| gloss recommend success | 실패 | 502 | 7.1 ms | `FASTAPI_SERVER_ERROR` |
| gloss recommend spring validation error | 실패 | 400 | 1.9 ms | `VALIDATION_ERROR` |

## 상세 결과

### 1. sign-to-speech success

- 시나리오: 은행 창구에서 고객이 계좌 이체나 통장 재발급 같은 업무를 수어로 표현했다고 가정하고, MediaPipe frame 1개가 포함된 sign-to-speech 요청을 Spring으로 보냅니다. Spring은 이 payload를 FastAPI /sign-to-speech로 전달해 수어 keypoint를 음성 변환 요청으로 중계합니다.
- 요청: `POST http://localhost:8080/api/translation/sign-to-speech`
- 기대 응답: 성공 시 HTTP 200과 함께 code=SUCCESS, data.type=sign_to_speech_result, glosses, korean, audio_url이 포함된 응답을 기대합니다. 실제 korean/glosses 내용은 모델 상태에 따라 달라질 수 있지만 은행 업무 맥락의 번역 결과가 반환되는지 확인합니다.
- 결과: **실패**
- HTTP 상태: `502`
- 응답시간: `145.6 ms`

응답 본문:
```json
{
  "code": "GLOSS_SEQUENCE_GENERATION_FAILED",
  "message": "생성된 gloss 시퀀스가 없습니다.",
  "data": null
}
```

### 2. sign-to-speech spring validation error

- 시나리오: 은행 도메인 요청이라도 frames를 빈 배열로 보내면 Spring Controller의 @Valid 검증이 먼저 실패하는지 확인합니다. 이 요청은 FastAPI까지 가지 않고 Spring 입력 검증 단계에서 차단되는 시나리오입니다.
- 요청: `POST http://localhost:8080/api/translation/sign-to-speech`
- 기대 응답: 실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 frames must not be empty 같은 Spring 검증 메시지가 내려오길 기대합니다.
- 결과: **실패**
- HTTP 상태: `400`
- 응답시간: `4.3 ms`

응답 본문:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "frames must not be empty.",
  "data": null
}
```

### 3. speech-to-sign audio success

- 시나리오: 은행 상담 음성이 들어왔다고 가정하고, 샘플 오디오 파일을 multipart/form-data로 업로드해 speech-to-sign 오디오 변환 요청을 보냅니다. Spring은 파일을 받아 FastAPI /speech-to-sign로 전달합니다.
- 요청: `POST http://localhost:8080/api/translation/speech-to-sign`
- 파일: `/Users/joonwan/S14P31E104/backend/test-client/sample.wav`
- 기대 응답: 성공 시 HTTP 200과 함께 code=SUCCESS, data.type=speech_to_sign_result, korean, glosses, gloss_str, keypoint_payload가 포함된 응답을 기대합니다. 실제 인식 문장은 샘플 음성에 따라 달라지지만 계좌, 이체, 통장, 재발급 같은 업무 표현으로 연결되는지 확인합니다.
- 결과: **성공**
- HTTP 상태: `200`
- 응답시간: `1102.0 ms`

응답 본문:
```json
{
  "code": "SUCCESS",
  "message": "요청이 성공했습니다.",
  "data": {
    "type": "speech_to_sign_result",
    "source": "hearing",
    "korean": "구독과 좋아요 부탁드려요!",
    "glosses": [
      "읽다",
      "또",
...
```

### 4. speech-to-sign missing file validation error

- 시나리오: multipart 요청은 보내지만 file 파트를 비워서 Spring이 업로드 파일 누락을 어떻게 처리하는지 확인합니다. 이 요청은 FastAPI까지 가지 않고 Spring 요청 바인딩 단계에서 실패하는 시나리오입니다.
- 요청: `POST http://localhost:8080/api/translation/speech-to-sign`
- 기대 응답: 실패 시 HTTP 400 또는 500 계열 응답과 함께 file 파트가 없다는 내용이 드러나는지 확인합니다. 현재 전역 예외 처리 범위 밖이면 Spring 기본 에러 응답이 보일 수 있습니다.
- 결과: **실패**
- HTTP 상태: `400`
- 응답시간: `2.6 ms`

응답 본문:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "필수 multipart 파트 'file'가 없습니다.",
  "data": null
}
```

### 5. text-to-sign success

- 시나리오: 은행 창구에서 자주 나올 수 있는 문장인 '통장 재발급을 도와주세요.'를 text-to-sign 요청으로 보내 FastAPI의 텍스트 기반 수어 변환 경로를 검증합니다. Spring은 JSON 본문을 FastAPI /text-to-sign로 전달합니다.
- 요청: `POST http://localhost:8080/api/translation/text-to-sign`
- 기대 응답: 성공 시 HTTP 200과 함께 code=SUCCESS, data 안에 korean, glosses, gloss_str, keypoint_url, keypoint_payload가 포함되길 기대합니다. glosses 역시 통장/재발급/부탁 계열의 은행 업무 표현으로 나오는지 확인합니다.
- 결과: **성공**
- HTTP 상태: `200`
- 응답시간: `166.2 ms`

응답 본문:
```json
{
  "code": "SUCCESS",
  "message": "요청이 성공했습니다.",
  "data": {
    "type": "speech_to_sign_result",
    "source": "hearing",
    "korean": "통장 재발급을 도와주세요.",
    "glosses": [
      "통장",
      "바꾸다",
...
```

### 6. text-to-sign spring validation error

- 시나리오: text 값에 공백만 넣어 Spring Controller의 @NotBlank 검증이 먼저 실패하는지 확인합니다. 이 요청은 FastAPI에 전달되지 않는 입력 검증 예외 시나리오입니다.
- 요청: `POST http://localhost:8080/api/translation/text-to-sign`
- 기대 응답: 실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 text가 비어 있으면 안 된다는 검증 메시지가 내려오길 기대합니다.
- 결과: **실패**
- HTTP 상태: `400`
- 응답시간: `6.3 ms`

응답 본문:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "must not be blank",
  "data": null
}
```

### 7. glosses-to-speech success

- 시나리오: 은행 업무 맥락의 gloss 문자열 목록인 '통장, 재발급, 부탁'을 speech 합성 요청으로 보내 glosses-to-speech 성공 경로를 검증합니다. Spring은 이 목록을 FastAPI /glosses-to-speech로 전달합니다.
- 요청: `POST http://localhost:8080/api/translation/glosses-to-speech`
- 기대 응답: 성공 시 HTTP 200과 함께 code=SUCCESS, data.type=sign_to_speech_result, glosses, korean, audio_url이 포함된 응답을 기대합니다. korean 문장도 통장 재발급 요청에 가까운 은행 문맥으로 생성되는지 확인합니다.
- 결과: **성공**
- HTTP 상태: `200`
- 응답시간: `496.5 ms`

응답 본문:
```json
{
  "code": "SUCCESS",
  "message": "요청이 성공했습니다.",
  "data": {
    "type": "sign_to_speech_result",
    "source": "signer",
    "glosses": [
      "통장",
      "재발급",
      "부탁"
...
```

### 8. glosses-to-speech spring validation error

- 시나리오: glosses를 빈 배열로 보내 Spring Controller의 @NotEmpty 검증이 먼저 실패하는지 확인합니다. FastAPI 이전 단계에서 차단되는 대표 입력 검증 예외 시나리오입니다.
- 요청: `POST http://localhost:8080/api/translation/glosses-to-speech`
- 기대 응답: 실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 glosses must not be empty 같은 Spring 검증 메시지가 내려오길 기대합니다.
- 결과: **실패**
- HTTP 상태: `400`
- 응답시간: `1.9 ms`

응답 본문:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "glosses must not be empty.",
  "data": null
}
```

### 9. glosses-to-speech fastapi detailed error

- 시나리오: 은행 도메인 요청이라도 gloss 값이 공백뿐이면 공통 예외가 나는지 확인하기 위해 공백만 들어 있는 gloss 배열을 보냅니다. Spring이 FastAPI 상세 에러를 읽어 React용 응답 code/message에 반영하는지 확인하는 핵심 시나리오입니다.
- 요청: `POST http://localhost:8080/api/translation/glosses-to-speech`
- 기대 응답: 실패 시 HTTP 502를 유지하되, 응답 본문에는 code=GLOSS_LIST_EMPTY, message=gloss 목록이 비어 있습니다. 같은 FastAPI 상세 에러가 들어오길 기대합니다.
- 결과: **실패**
- HTTP 상태: `502`
- 응답시간: `3.1 ms`

응답 본문:
```json
{
  "code": "GLOSS_LIST_EMPTY",
  "message": "gloss 목록이 비어 있습니다.",
  "data": null
}
```

### 10. gloss recommend success

- 시나리오: 은행 도메인 맥락에서 gloss 추천 요청을 보내 Spring GlossController와 FastAPI /glosses/recommend 연동을 확인합니다. category=banking, sequence=계좌/이체를 기반으로 추천 목록을 조회하는 시나리오입니다.
- 요청: `POST http://localhost:8080/api/glosses/recommend`
- 기대 응답: 성공 시 HTTP 200과 함께 code=SUCCESS, data.recommendations 배열이 포함된 응답을 기대합니다. 추천 결과도 송금, 입금, 출금, 통장, 재발급처럼 은행 업무와 연결된 단어들인지 확인합니다.
- 결과: **실패**
- HTTP 상태: `502`
- 응답시간: `7.1 ms`

응답 본문:
```json
{
  "code": "FASTAPI_SERVER_ERROR",
  "message": "FastAPI 서버 오류가 발생했습니다.",
  "data": null
}
```

### 11. gloss recommend spring validation error

- 시나리오: category에 공백만 넣어 Spring Controller의 @NotBlank 검증이 먼저 실패하는지 확인합니다. 추천 요청의 입력 검증 예외 시나리오입니다.
- 요청: `POST http://localhost:8080/api/glosses/recommend`
- 기대 응답: 실패 시 HTTP 400과 함께 code=VALIDATION_ERROR, message에는 category가 비어 있으면 안 된다는 검증 메시지가 내려오길 기대합니다.
- 결과: **실패**
- HTTP 상태: `400`
- 응답시간: `1.9 ms`

응답 본문:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "must not be blank",
  "data": null
}
```
