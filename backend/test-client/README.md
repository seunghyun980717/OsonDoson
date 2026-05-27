# test-client

Spring `TranslationClient` 연동 확인용 FastAPI 서버다.

## 엔드포인트

- `GET /health`
- `POST /sign2speech`
- `POST /speech-to-sign/audio`
- `POST /speech-to-sign/text/keypoints`
- `GET /static/audio/{fileName}`
- `GET /static/json/{fileName}`

## 로컬 실행

```bash
cd test-client
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`/speech-to-sign/audio` 엔드포인트가 `multipart/form-data` 업로드를 처리하므로 `python-multipart`가 함께 설치된다.

## 가상환경 사용 방법

### 1. 가상환경 생성

```bash
cd test-client
python3 -m venv .venv
```

### 2. 가상환경 활성화

```bash
source .venv/bin/activate
```

활성화되면 터미널 앞에 `(.venv)`가 표시된다.

### 3. 의존성 설치

```bash
pip install -r requirements.txt
```

### 4. 서버 실행

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 5. 서버 종료

- 실행 중인 터미널에서 `Ctrl + C`

### 6. 가상환경 비활성화

```bash
deactivate
```

## Docker 실행

```bash
cd test-client
docker build -t sign2speech-test-client .
docker run --rm -p 8000:8000 sign2speech-test-client
```

## 응답 동작

- 요청을 받으면 2초 대기
- `POST /sign2speech`
  - Spring이 기대하는 sign-to-speech 응답 형식(`type`, `source`, `glosses`, `korean`, `audio_url`, `audio`)을 반환
- `POST /speech-to-sign/audio`
  - Spring이 기대하는 speech-to-sign 오디오 응답 형식(`korean`, `glosses`, `gloss_str`, `keypoint_url`, `keypoint_path`, `keypoint_payload`, `resolved_glosses`, `missing_glosses`, `coverage`, `timings`)을 반환
- `POST /speech-to-sign/text/keypoints`
  - Spring이 기대하는 speech-to-sign 텍스트 응답 형식을 반환
- `audio_url`로 내려준 `/static/audio/sample-sign2speech.mp3` 요청 시 `audio/mpeg` 바이너리 응답 반환
- `keypoint_url`로 내려준 `/static/json/sample-speech2sign.json` 요청 시 더미 keypoint payload를 반환
