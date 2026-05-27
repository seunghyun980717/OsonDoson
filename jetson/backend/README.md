# Jetson Backend

청인(상담원)과 농인 사용자 간 1:1 실시간 통신을 중계하는 FastAPI WebSocket 서버입니다.
Jetson Nano 위에서 동작하는 것을 목표로 합니다.

---

## 역할

```
청인 클라이언트 (/ws/hearing)
        |
        |  WebSocket
        |
  FastAPI 서버  ←→  AI 파이프라인 (mock_translation.py)
        |
        |  WebSocket
        |
수어 사용자 클라이언트 (/ws/signer)
```

- 청인이 텍스트 또는 음성을 입력하면 서버가 수어(글로스 + 영상)로 변환해 수어 사용자에게 전달합니다.
- 수어 사용자가 수어 키포인트 또는 영상을 전송하면 서버가 한국어 텍스트 + 음성으로 변환해 청인에게 전달합니다.
- 현재는 Mock 함수로 고정 응답을 반환하며, 실제 AI 모델 연동 시 `mock_translation.py`만 교체하면 됩니다.

---

## 디렉토리 구조

```
app/
├── main.py                      # FastAPI 앱 생성, CORS, 라우터 등록, /health
├── routers/
│   └── ws.py                    # /ws/hearing, /ws/signer WebSocket 엔드포인트 정의
├── websocket/
│   ├── manager.py               # ConnectionManager: 연결 관리 및 피어 메시지 전달
│   └── handlers.py              # 메시지 타입별 비즈니스 로직
└── services/
    └── mock_translation.py      # AI 파이프라인 교체 포인트 (현재 Mock)

docs/
└── ai_integration_guide.md      # AI 담당자용 파이프라인 연동 가이드
```

### 각 파일 역할

| 파일 | 역할 | 수정 여부 |
|---|---|---|
| `main.py` | 앱 초기화, CORS, 라우터 등록 | 모델 로딩 추가 시 수정 |
| `routers/ws.py` | WebSocket 엔드포인트 | 수정 불필요 |
| `websocket/manager.py` | 연결 관리, 피어 메시지 전달 | 수정 불필요 |
| `websocket/handlers.py` | 메시지 타입 분기 처리 | 수정 불필요 |
| `services/mock_translation.py` | AI 파이프라인 인터페이스 | **AI 연동 시 이 파일만 수정** |

---

## WebSocket 엔드포인트

| 엔드포인트 | 대상 |
|---|---|
| `ws://host:8000/ws/hearing` | 청인(상담원) 클라이언트 |
| `ws://host:8000/ws/signer` | 수어 사용자 클라이언트 |

1:1 구조로 각 역할당 1개의 연결만 유지합니다. 새 연결이 들어오면 기존 연결은 자동으로 종료됩니다.

---

## 메시지 흐름

### 청인 → 농인 (Speech to Sign)

```
청인: { type: "hearing_text", text: "어디로 가고 싶으세요?" }
                    ↓
      서버: mock_speech_to_sign() 호출
                    ↓
농인: { type: "speech_to_sign_result", korean: "...", glosses: [...], keypoint_sequence: [...] }
```

```
청인: { type: "hearing_audio", audio_base64: "...", format: "webm" }
                    ↓
      서버: mock_audio_to_text() → mock_speech_to_sign() 호출
                    ↓
농인: { type: "speech_to_sign_result", korean: "...", glosses: [...], keypoint_sequence: [...] }
```

### 수어 사용자 → 청인 (Sign to Speech)

```
수어 사용자: { type: "signer_keypoints", frames: [...] }
                    ↓
      서버: mock_keypoints_to_speech() 호출
                    ↓
청인: { type: "sign_to_speech_result", glosses: [...], korean: "...", audio: { data: "..." } }
```

---

## 실행 방법

```bash
cd jetson/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### API 문서

서버 실행 후 브라우저에서 확인:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Health Check: `http://localhost:8000/health`

---

## AI 파이프라인 연동

`services/mock_translation.py` 의 함수 4개를 실제 모델로 교체하면 됩니다.

| 함수 | 역할 |
|---|---|
| `mock_audio_to_text` | 음성 → 한국어 텍스트 (STT) |
| `mock_speech_to_sign` | 한국어 텍스트 → 수어 글로스 + 영상 |
| `mock_keypoints_to_speech` | 수어 키포인트 → 한국어 + 음성 |

자세한 연동 방법은 [docs/ai_integration_guide.md](docs/ai_integration_guide.md) 를 참고하세요.
