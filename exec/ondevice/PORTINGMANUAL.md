# On-Device 포팅 매뉴얼

## 0. 설치 기준 경로

- 본 문서는 Jetson 장비의 Linux 셸 환경을 기준으로 작성한다.
- 프로젝트는 아래 경로에 clone한 것을 기준으로 한다.
  - `~/S14P31E104`
- 예시:

```bash
cd ~
git clone https://lab.ssafy.com/s14-final/S14P31E104.git S14P31E104
cd ~/S14P31E104
```

- 이후 문서에 표기된 모든 경로는 `~/S14P31E104` 기준으로 해석한다.

## 1. 문서 범위

### 1.1 대상 경로

- Jetson 온디바이스 실행 관련 소스 경로는 `jetson/` 하위 디렉토리이다.
- 본 문서는 다음 경로를 기준으로 작성한다.
  - `~/S14P31E104/jetson/frontend`
  - `~/S14P31E104/jetson/backend`

### 1.2 구성요소

- `frontend`
  - Jetson 디바이스에서 실행하는 사용자용 프론트엔드이다.
  - React, TypeScript, Vite 기반으로 구성되어 있다.
- `backend`
  - Jetson 디바이스에서 실행하는 FastAPI 기반 백엔드 서버이다.
  - WebSocket 통신을 통해 청인 사용자와 농인 사용자 간 실시간 통신을 중계한다.

### 1.3 실행 흐름

- Jetson 온디바이스 실행은 `backend`와 `frontend`를 함께 구동하는 것을 기준으로 한다.
- `backend`는 FastAPI 서버로 실행되며, AI 추론 로직과 WebSocket 통신을 담당한다.
- `frontend`는 브라우저 기반 UI를 제공하며, `backend`와 연동하여 실시간 기능을 수행한다.
- 실제 AI 런타임 코드는 `backend/app/ai_runtime` 경로를 기준으로 동작한다.

## 2. 실행 환경

### 2.1 하드웨어

- 온디바이스 실행 대상은 NVIDIA Jetson 계열 디바이스를 기준으로 한다.
- Jetson 디바이스에서 `frontend`와 `backend`를 함께 실행하며, `backend`는 AI 런타임 및 모델 자산을 참조한다.

### 2.2 운영체제

- Jetson Linux 환경에서 실행하는 것을 기준으로 한다.
- Jetson 전용 Python 패키지, 특히 PyTorch 계열 패키지는 JetPack/L4T 버전에 맞는 바이너리를 사용해야 한다.

### 2.3 필수 소프트웨어 및 버전

| 구분 | 항목 | 값 |
|---|---|---|
| Python 환경 | 배포판 | `Miniforge`(권장) 또는 `conda` 명령이 포함된 배포판 |
| Python 환경 | 가상환경 | `conda`의 `sonpyeonji-ai` |
| Backend 런타임 | 웹 서버 | `FastAPI`, `Uvicorn` |
| Frontend 런타임 | 개발 서버 | `Node.js`, `Vite` |

| Backend 주요 패키지 | 버전 |
|---|---|
| `fastapi` | `0.135.3` |
| `uvicorn[standard]` | `0.44.0` |
| `numpy` | `2.2.6` |
| `transformers` | `4.44.2` |
| `tokenizers` | `0.19.1` |
| `safetensors` | `0.8.0rc0` |
| `sentencepiece` | `0.2.1` |
| `openai-whisper` | `20250625` |
| `openai` | `2.32.0` |
| `sentence-transformers` | `5.4.1` |
| `mediapipe` | `0.10.9` |
| `opencv-contrib-python` | `4.13.0.92` |
| `opencv-python` | `4.13.0.92` |

- Jetson 전용 PyTorch 계열 패키지는 JetPack/L4T 환경에 맞는 바이너리를 별도 설치해야 한다.
- Jetson ARM 환경에서는 `conda` 설치를 위해 `Miniforge` 사용을 권장한다.

| Frontend 주요 패키지 | 버전 |
|---|---|
| `react` | `19.2.5` |
| `react-dom` | `19.2.5` |
| `react-router-dom` | `7.14.2` |
| `vite` | `8.0.10` |
| `typescript` | `6.0.2` |
| `three` | `0.179.1` |
| `@mediapipe/tasks-vision` | `0.10.35` |

### 2.4 네트워크 및 포트

- `backend`는 기본적으로 `0.0.0.0:8000` 포트에서 실행한다.
- `backend` 실행 스크립트 `run_jetson.sh` 에서 다음 환경변수를 사용한다.

| 환경변수 | 값 | 의미 |
|---|---|---|
| `LKS_PROFILE` | `jetson` | 실행 환경 프로파일 지정 |
| `LKS_PRELOAD_MODELS` | `true` | 서버 기동 시 모델을 미리 로드할지 여부 |
| `LKS_ENABLE_TTS` | `true` | Text-to-Speech 기능 사용 여부 |
| `LKS_ENABLE_STT` | `true` | Speech-to-Text 기능 사용 여부 |

- `frontend`는 Vite 개발 서버로 실행하며, 기본 개발 포트는 Vite 기본 포트를 따른다.
- 온디바이스 프론트엔드와 백엔드가 서로 통신할 수 있도록 동일 네트워크 또는 Jetson 로컬 환경에서 실행해야 한다.
## 3. 실행에 필요한 data 디렉토리 배치

### 3.1 data 디렉토리 배치 경로

- 온디바이스 `backend` 실행에 필요한 런타임 데이터는 아래 경로에 배치해야 한다.
  - `~/S14P31E104/jetson/backend/app/ai_runtime/data`
- Git clone 이후 위 경로에 `data` 디렉토리가 없거나 필요한 파일이 누락된 경우, 서버는 실행되더라도 실제 추론 기능은 정상 동작하지 않을 수 있다.

### 3.2 필수 데이터 파일 및 디렉토리

- 아래 파일 및 디렉토리가 `data` 경로 하위에 존재해야 한다.
  - `derived/checkpoints/best.pt`
  - `derived/checkpoints/seq2seq/best/`
  - `derived/vocab.json`
  - `derived/word_db_generated.json`
- 필요 시 아래 경로도 함께 확인한다.
  - `word_dic/`
  - `derived/checkpoints/seq2seq_smoke/`

### 3.3 data 디렉토리 용도

| 경로 | 용도 |
|---|---|
| `derived/checkpoints/best.pt` | sign-to-speech 모델 체크포인트 |
| `derived/checkpoints/seq2seq/best/` | 한국어 ↔ 글로스 변환용 seq2seq 모델 디렉토리 |
| `derived/vocab.json` | 글로스 vocabulary 파일 |
| `derived/word_db_generated.json` | 글로스와 실제 리소스 매핑에 사용하는 런타임 DB 파일 |

### 3.4 배치 후 확인 방법

- 아래 명령으로 `data` 디렉토리 및 주요 파일 존재 여부를 확인한다.

```bash
cd ~/S14P31E104/jetson/backend/app/ai_runtime
ls
ls data/derived
ls data/derived/checkpoints
ls data/derived/checkpoints/seq2seq/best
```

- `backend` 실행 후 sign-to-speech, speech-to-sign 기능이 모두 정상 동작하는지 확인한다.
- `data` 디렉토리 경로가 다르거나 파일이 누락된 경우, 모델 로딩 실패 또는 gloss 생성 실패가 발생할 수 있다.

## 4. Backend 실행 방법

### 4.1 대상 경로

- Jetson 온디바이스 백엔드 소스 경로는 `jetson/backend` 이다.
- 실행 기준 경로는 다음과 같다.
  - `~/S14P31E104/jetson/backend`

### 4.2 conda 설치

- Jetson 장비에 `conda` 명령이 없다면 먼저 `Miniforge` 를 설치한다.
- 아래 예시는 `aarch64` Jetson Linux 환경 기준 설치 예시이다.

```bash
cd ~
wget https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-aarch64.sh
bash Miniforge3-Linux-aarch64.sh -b -p "$HOME/miniforge3"
source "$HOME/miniforge3/bin/activate"
conda init bash
exec "$SHELL"
```

- 설치 완료 후 아래 명령으로 `conda` 사용 가능 여부를 확인한다.

```bash
conda --version
```

### 4.3 Python 가상환경 생성 및 활성화

- `backend` 실행은 `conda` 가상환경 `sonpyeonji-ai` 를 기준으로 한다.
- 최초 1회 아래 명령으로 가상환경을 생성한다.

```bash
conda create -n sonpyeonji-ai python=3.11 -y
```

- 생성 후 아래 명령으로 가상환경을 활성화한다.

```bash
conda activate sonpyeonji-ai
```

- 이미 `sonpyeonji-ai` 환경이 존재한다면 생성 단계는 생략하고 활성화만 수행한다.

### 4.4 필수 패키지 설치

- `backend` 실행에 필요한 패키지는 `requirements.txt` 기준으로 설치한다.
- 설치 명령은 다음과 같다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/jetson/backend
pip install -r requirements.txt
```

- `requirements.txt` 는 실제 실행 검증된 `sonpyeonji-ai` 환경 기준으로 정리되어 있다.

### 4.5 Jetson 전용 PyTorch 설치 주의사항

- Jetson 장비에서는 `pip install torch` 로 일반 PyTorch를 설치하지 않는다.
- JetPack/L4T 버전에 맞는 NVIDIA 제공 PyTorch wheel을 별도로 설치해야 한다.
- `torch`, `torchvision`, `torchaudio` 계열은 Jetson 장비 환경에 맞춰 개별 설치한다.
- `requirements.txt` 는 Jetson 호환 PyTorch wheel 설치 이후에 적용하는 것을 권장한다.

### 4.6 환경변수 설정

- `backend` 실행 전 아래 환경변수를 설정한다.

```bash
export LKS_PROFILE=jetson
export LKS_PRELOAD_MODELS=true
export LKS_ENABLE_TTS=true
export LKS_ENABLE_STT=true
```

| 환경변수 | 의미 |
|---|---|
| `LKS_PROFILE` | 실행 환경 프로파일 지정 |
| `LKS_PRELOAD_MODELS` | 서버 기동 시 모델을 미리 로드할지 여부 |
| `LKS_ENABLE_TTS` | Text-to-Speech 기능 사용 여부 |
| `LKS_ENABLE_STT` | Speech-to-Text 기능 사용 여부 |

### 4.7 실행 명령어

- `backend` 실행 명령은 다음과 같다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/jetson/backend
export LKS_PROFILE=jetson
export LKS_PRELOAD_MODELS=true
export LKS_ENABLE_TTS=true
export LKS_ENABLE_STT=true
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 또는 저장소에 포함된 실행 스크립트를 사용해도 된다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/jetson/backend
bash run_jetson.sh
```

### 4.8 동작 확인 방법

- `backend` 실행 후 아래 주소로 접속하여 서버 상태를 확인한다.
  - `http://localhost:8000/health`
  - `http://localhost:8000/docs`
- `sign-to-speech`, `speech-to-sign` 기능이 모두 정상 동작하는지 확인한다.
- 프론트엔드와 연동하는 경우 WebSocket 서버가 `8000` 포트에서 열려 있는지 확인한다.

## 5. Frontend 실행 방법

### 5.1 대상 경로

- Jetson 온디바이스 프론트엔드 소스 경로는 `jetson/frontend` 이다.
- 실행 기준 경로는 다음과 같다.
  - `~/S14P31E104/jetson/frontend`

### 5.2 Node.js 및 npm 버전

- 프론트엔드는 Node.js 및 npm 환경이 필요하다.
- 실행 전 `node -v`, `npm -v` 명령으로 Node.js와 npm 설치 여부를 확인한다.
- 패키지 매니저는 `npm` 을 기준으로 한다.

### 5.3 의존성 설치

- 프론트엔드 최초 실행 시 아래 명령으로 의존성을 설치한다.

```bash
cd ~/S14P31E104/jetson/frontend
npm install
```

| 주요 프론트엔드 패키지 | 비고 |
|---|---|
| `react` | 프론트엔드 UI 라이브러리 |
| `react-dom` | React DOM 렌더링 |
| `react-router-dom` | 라우팅 처리 |
| `vite` | 개발 서버 및 빌드 도구 |
| `typescript` | 정적 타입 지원 |
| `three` | 3D 렌더링 |
| `@mediapipe/tasks-vision` | MediaPipe 비전 태스크 실행 |

### 5.4 개발 서버 실행

- 온디바이스 프론트엔드는 Vite 개발 서버로 실행한다.
- 실행 명령은 다음과 같다.

```bash
cd ~/S14P31E104/jetson/frontend
npm run dev
```

| 항목 | 값 | 의미 |
|---|---|---|
| `host` | `true` | 외부 기기에서도 개발 서버 접속 허용 |
| `port` | `5173` | 프론트엔드 개발 서버 포트 |
| `strictPort` | `true` | 포트 충돌 시 다른 포트로 fallback 하지 않음 |

- 따라서 개발 서버 기본 접속 주소는 다음과 같다.
  - `http://localhost:5173`

### 5.5 환경 파일 생성

- `frontend` 실행 및 빌드 전에 `.env.development` 파일을 생성하고 아래 값을 설정한다.

```bash
cd ~/S14P31E104/jetson/frontend
cat <<'EOF' > .env.development
VITE_WS_BASE=ws://localhost:8000
EOF
```

- `backend` 와 동일 장비에서 실행하는 경우 위 값을 그대로 사용한다.
- 다른 장비에서 프론트엔드를 접속하는 경우, 필요 시 `localhost` 를 Jetson 장비의 실제 IP 주소로 변경한다.

### 5.6 빌드 방법

- 배포용 정적 파일을 생성하려면 아래 명령을 실행한다.

```bash
cd ~/S14P31E104/jetson/frontend
npm run build
```

- 빌드 결과물은 Vite 기본 출력 디렉토리인 `dist/` 에 생성된다.

### 5.7 동작 확인 방법

- 프론트엔드 실행 전 `backend` 가 먼저 실행되어 있어야 한다.
- 프론트엔드는 `.env.development` 파일의 `VITE_WS_BASE` 값을 사용하여 백엔드 WebSocket 서버에 연결한다.
- 프론트엔드 실행 후 브라우저에서 `http://localhost:5173` 로 접속하여 UI가 정상적으로 열리는지 확인한다.
- 백엔드와 연결되지 않으면 WebSocket 연결 실패가 발생하므로, `backend` 서버가 `8000` 포트에서 정상 실행 중인지 먼저 확인한다.

## 6. 전체 실행 순서

### 6.1 backend 실행

- 먼저 `data` 디렉토리가 아래 경로에 정상 배치되어 있는지 확인한다.
  - `~/S14P31E104/jetson/backend/app/ai_runtime/data`
- 이후 `backend` 를 다음 순서로 실행한다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/jetson/backend
export LKS_PROFILE=jetson
export LKS_PRELOAD_MODELS=true
export LKS_ENABLE_TTS=true
export LKS_ENABLE_STT=true
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 또는 아래 스크립트로 실행할 수 있다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/jetson/backend
bash run_jetson.sh
```

### 6.2 frontend 실행

- `backend` 실행 후 새 터미널을 열어 `frontend` 를 실행한다.

```bash
cd ~/S14P31E104/jetson/frontend
npm install
npm run dev
```

- 이미 의존성 설치가 끝난 환경이라면 `npm install` 은 생략 가능하다.

```bash
cd ~/S14P31E104/jetson/frontend
npm run dev
```

### 6.3 연동 확인

- `backend` 실행 확인
  - `http://localhost:8000/health`
  - `http://localhost:8000/docs`
- `frontend` 실행 확인
  - `http://localhost:5173`
- `.env.development` 의 WebSocket 서버 주소가 아래와 같이 설정되어 있는지 확인한다.

```env
VITE_WS_BASE=ws://localhost:8000
```

- 최종적으로 브라우저에서 프론트엔드에 접속한 뒤, sign-to-speech 및 speech-to-sign 기능이 정상 동작하는지 확인한다.

## 7. 배포 시 특이사항

### 7.1 Jetson 전용 의존성 설치 유의사항

- Jetson 장비에서는 일반 PC 환경과 동일한 방식으로 PyTorch를 설치하면 동작하지 않을 수 있다.
- `torch`, `torchvision`, `torchaudio` 계열 패키지는 JetPack/L4T 버전에 맞는 Jetson 전용 빌드를 사용해야 한다.
- `requirements.txt` 설치 전 또는 후에 Jetson 호환 PyTorch wheel 설치 여부를 먼저 확인한다.
- `mediapipe`, `opencv`, `whisper`, `sounddevice` 계열 패키지는 장비 환경에 따라 추가 시스템 라이브러리가 필요할 수 있으므로, 설치 실패 시 Jetson OS 패키지 의존성을 함께 확인한다.

### 7.2 절대경로/상대경로 주의사항

- 본 문서는 `~/S14P31E104` 경로를 기준으로 작성되었다.
- 실제 clone 경로가 다를 경우, 문서에 기재된 모든 실행 경로를 동일한 기준으로 변경해야 한다.
- 특히 아래 경로는 실제 기능 동작과 직접 연결되므로 정확한 위치를 유지해야 한다.
  - `~/S14P31E104/jetson/backend`
  - `~/S14P31E104/jetson/frontend`
  - `~/S14P31E104/jetson/backend/app/ai_runtime/data`
- `data` 디렉토리 위치가 달라지거나 내부 파일이 누락되면 서버는 실행되더라도 추론 기능이 실패할 수 있다.

### 7.3 성능 및 자원 사용 주의사항

- `LKS_PRELOAD_MODELS=true` 설정 시 서버 시작 시점에 모델을 미리 로드하므로, 초기 기동 시간이 길어질 수 있다.
- sign-to-speech, speech-to-sign 기능을 동시에 사용하는 경우 메모리 사용량이 증가할 수 있다.
- Jetson 장비 성능에 따라 STT, TTS, seq2seq, keypoint 처리 시간이 길어질 수 있으므로, 최초 실행 시 응답 지연이 발생할 수 있다.
- 개발 단계에서는 `frontend` 와 `backend` 를 동시에 실행하므로 CPU 및 메모리 사용량을 함께 확인하는 것을 권장한다.
- 추론 실패가 발생하면 먼저 `data` 디렉토리 배치, 모델 파일 존재 여부, 환경변수 설정을 우선 점검한다.

## 8. 주요 설정 파일 목록

### 8.1 backend 설정 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/jetson/backend/requirements.txt` | 온디바이스 백엔드 Python 의존성 목록 | `pip install -r requirements.txt` 에 사용 |
| `~/S14P31E104/jetson/backend/run_jetson.sh` | `LKS_PROFILE=jetson` 환경으로 백엔드를 실행하는 스크립트 | `LKS_PRELOAD_MODELS=true`, `LKS_ENABLE_TTS=true`, `LKS_ENABLE_STT=true` 설정 후 `uvicorn app.main:app --host 0.0.0.0 --port 8000` 실행 |
| `~/S14P31E104/jetson/backend/run_local.sh` | `LKS_PROFILE=local` 환경으로 백엔드를 실행하는 로컬 개발용 스크립트 | `LKS_PRELOAD_MODELS=true`, `LKS_ENABLE_TTS=true`, `LKS_ENABLE_STT=true` 설정 후 `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` 실행 |
| `~/S14P31E104/jetson/backend/app/main.py` | FastAPI 앱 진입점 | 서버 시작 진입 파일 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/core/config.py` | AI 런타임 주요 설정 파일 | 모델/데이터/동작 설정 포함 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/settings.py` | AI 런타임 환경 설정 관련 파일 | 런타임 설정 로딩용 |

### 8.2 frontend 설정 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/jetson/frontend/package.json` | 프론트엔드 의존성 및 실행 스크립트 정의 | `npm install`, `npm run dev`, `npm run build` 기준 파일 |
| `~/S14P31E104/jetson/frontend/vite.config.ts` | Vite 개발 서버 포트 및 호스트 설정 | `host`, `port`, `strictPort` 포함 |
| `~/S14P31E104/jetson/frontend/.env.development` | WebSocket 서버 주소 설정 | `VITE_WS_BASE` 정의 |

### 8.3 backend 내부 AI 런타임 관련 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/jetson/backend/app/ai_runtime/data/derived/checkpoints/best.pt` | sign-to-speech 모델 체크포인트 | CTC 모델 체크포인트 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/data/derived/checkpoints/seq2seq/best/` | seq2seq 모델 디렉토리 | 한국어 ↔ 글로스 변환용 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/data/derived/vocab.json` | 글로스 vocabulary 파일 | gloss 토큰 목록 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/data/derived/word_db_generated.json` | 글로스 매핑 DB 파일 | gloss와 리소스 매핑 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/runtime/speech_to_sign/korean_to_gloss.py` | 한국어 → 글로스 변환 로직 | T5/후처리 로직 포함 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/runtime/speech_to_sign/stt.py` | 음성 → 텍스트 변환 로직 | Whisper STT 사용 |
| `~/S14P31E104/jetson/backend/app/ai_runtime/services/speech_to_sign.py` | speech-to-sign 파이프라인 서비스 | STT, gloss 변환, keypoint/video 생성 연결 |
