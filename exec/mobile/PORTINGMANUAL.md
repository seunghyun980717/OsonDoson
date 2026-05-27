# Mobile 포팅 매뉴얼

## 0. 설치 기준 경로

- 본 문서는 Linux 셸 환경을 기준으로 작성한다.
- 프로젝트는 아래 경로에 clone한 것을 기준으로 한다.
  - `~/S14P31E104`
- 예시:

```bash
cd ~
git clone https://lab.ssafy.com/s14-final/S14P31E104.git S14P31E104
cd ~/S14P31E104
```

- 이후 문서에 표기된 모든 경로는 `~/S14P31E104` 기준으로 해석한다.

## 1. 실행 환경

### 1.1 운영체제

- Web 서비스 실행은 Linux 서버 환경을 기준으로 한다.
- `FastAPI`, `Spring`, `frontend/web` 을 동일 장비 또는 서로 통신 가능한 네트워크 환경에서 실행하는 것을 기준으로 한다.
- `FastAPI` 서버는 Python 런타임과 모델/data 자산을 필요로 하며, `Spring` 서버는 MongoDB 연결 정보가 필요하다.

### 1.2 필수 소프트웨어 및 버전

| 구분 | 항목 | 값 |
|---|---|---|
| Python 환경 | 배포판 | `Miniforge`(권장) 또는 `conda` 명령이 포함된 배포판 |
| Python 환경 | 가상환경 | `conda`의 `sonpyeonji-ai` |
| FastAPI 런타임 | 웹 서버 | `FastAPI`, `Uvicorn` |
| Spring 런타임 | JDK | `Java 17` |
| Spring 빌드 도구 | Gradle | 저장소 포함 `gradlew` 사용 |
| Web 런타임 | 개발 서버 | `Node.js`, `Vite` |
| 데이터베이스 | DBMS | `MongoDB 7` |

| FastAPI 주요 패키지 | 버전 또는 조건 |
|---|---|
| `fastapi` | `>=0.115,<1.0` |
| `uvicorn[standard]` | `>=0.30,<1.0` |
| `transformers` | `4.44.2` |
| `tokenizers` | `0.19.1` |
| `torch` | `>=2.4,<3.0` |
| `openai-whisper` | `>=20240930` |
| `sentencepiece` | `>=0.2,<1.0` |
| `openai` | `>=1.52,<2.0` |
| `sentence-transformers` | `>=3.2,<4.0` |
| `httpx` | `>=0.27,<1.0` |

| Spring 주요 설정 | 값 |
|---|---|
| `Spring Boot` | `3.5.14` |
| `springdoc-openapi-starter-webmvc-ui` | `2.8.13` |
| `MongoDB Starter` | `spring-boot-starter-data-mongodb` |

| Web 주요 패키지 | 버전 |
|---|---|
| `react` | `19.2.5` |
| `react-dom` | `19.2.5` |
| `react-router-dom` | `7.14.2` |
| `vite` | `8.0.10` |
| `typescript` | `~5.9.2` |
| `three` | `0.179.1` |
| `@mediapipe/tasks-vision` | `0.10.35` |

- Spring 서버는 저장소에 포함된 `gradlew` 스크립트를 기준으로 빌드 및 실행한다.
- FastAPI 런타임은 `requirements.txt` 기준으로 설치하며, 실제 추론을 위해 별도 `data` 디렉토리 배치가 필요하다.

### 1.3 네트워크 및 포트

| 구성요소 | 포트 | 설명 |
|---|---|---|
| `FastAPI` | `8000` | AI 서버 기본 실행 포트 |
| `Spring Boot` | `8080` | 로컬 개발 실행 시 기본 포트 |
| `frontend/web` | `5173` | Vite 개발 서버 포트 |
| `MongoDB` | `27017` | MongoDB 기본 포트 |

| 구성요소 | 추가 설정 | 설명 |
|---|---|---|
| `Vite dev proxy` | `VITE_DEV_PROXY_TARGET` | 미설정 시 `http://localhost:8080` 으로 프록시 |
| `Spring -> FastAPI` | `SIGN2SPEECH_FASTAPI_BASE_URL` | 미설정 시 `http://localhost:8000` 사용 |
| `Docker Compose backend` | `8081:8080` | 컨테이너 배포 시 외부 `8081` 포트를 내부 `8080` 에 매핑 |

- `frontend/web` 의 `/api` 요청은 개발 환경에서 Vite proxy를 통해 Spring 서버로 전달된다.
- Spring 서버는 내부적으로 FastAPI 서버와 통신하므로, Web 서비스 실행 시 `FastAPI` 와 `Spring` 이 모두 정상 기동되어 있어야 한다.

## 2. FastAPI 서버 실행 방법

### 2.1 대상 경로

- FastAPI 서버 소스 경로는 `fastapi` 이다.
- 실행 기준 경로는 다음과 같다.
  - `~/S14P31E104/fastapi`

### 2.2 conda 설치

- `conda` 명령이 없다면 먼저 `Miniforge` 를 설치한다.
- 아래 예시는 Linux 환경 기준 설치 예시이다.

```bash
cd ~
wget https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh
bash Miniforge3-Linux-x86_64.sh -b -p "$HOME/miniforge3"
source "$HOME/miniforge3/bin/activate"
conda init bash
exec "$SHELL"
```

- WSL 또는 일반 x86_64 Linux 검증 환경에서는 위 설치 파일을 사용한다.
- 실제 Jetson(aarch64) 환경에서는 아키텍처에 맞는 `Miniforge3-Linux-aarch64.sh` 설치 파일을 사용한다.

### 2.3 Python 가상환경 생성 및 활성화

- FastAPI 서버 실행은 `conda` 가상환경 `sonpyeonji-ai` 를 기준으로 한다.
- 최초 1회 아래 명령으로 가상환경을 생성한다.

```bash
conda create -n sonpyeonji-ai python=3.11 -y
```

- 생성 후 아래 명령으로 가상환경을 활성화한다.

```bash
conda activate sonpyeonji-ai
```

- 이미 `sonpyeonji-ai` 환경이 존재한다면 생성 단계는 생략하고 활성화만 수행한다.

### 2.4 필수 패키지 설치

- FastAPI 서버 실행 검증은 `requirements-runtime.txt` 기준으로 수행하였다.
- 실행용 의존성 설치 명령은 다음과 같다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/fastapi
pip install -r requirements-runtime.txt
```

- `requirements.txt` 는 전체/연구용 의존성이 포함될 수 있으므로, 웹 서비스 실행 기준 포팅 매뉴얼에서는 `requirements-runtime.txt` 를 우선 사용한다.

### 2.5 실행에 필요한 data 디렉토리 배치

- FastAPI 실행에 필요한 런타임 데이터는 아래 경로에 배치해야 한다.
  - `~/S14P31E104/fastapi/data`
- Git clone 이후 위 경로에 `data` 디렉토리가 없거나 필요한 파일이 누락된 경우, 서버는 실행되더라도 모델 preload 단계에서 기동이 실패할 수 있다.

- 주요 확인 경로:
  - `~/S14P31E104/fastapi/data/derived/checkpoints/best.pt`
  - `~/S14P31E104/fastapi/data/derived/checkpoints/seq2seq/best/`
  - `~/S14P31E104/fastapi/data/derived/vocab.json`
  - `~/S14P31E104/fastapi/data/derived/word_db_generated.json`
  - `~/S14P31E104/fastapi/data/bigram.json`
  - `~/S14P31E104/fastapi/data/trigram.json`
  - `~/S14P31E104/fastapi/data/starter.json`
  - `~/S14P31E104/fastapi/data/word2vec.model`

- 배치 후 확인 예시:

```bash
cd ~/S14P31E104/fastapi
ls data
ls data/derived
ls data/derived/checkpoints
ls data/derived/checkpoints/seq2seq/best
```

### 2.6 환경변수 설정

- FastAPI 서버 실행 전 아래 환경변수를 설정한다.

```bash
export LKS_PROFILE=runpod
export LKS_PRELOAD_MODELS=1
```

| 환경변수 | 값 | 의미 |
|---|---|---|
| `LKS_PROFILE` | `runpod` | 실행 환경 프로파일 지정 |
| `LKS_PRELOAD_MODELS` | `1` | 서버 기동 시 모델을 미리 로드할지 여부 |

### 2.7 실행 명령어

- FastAPI 서버 실행 명령은 다음과 같다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/fastapi
export LKS_PROFILE=runpod
export LKS_PRELOAD_MODELS=1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 실행 검증 시 아래 항목이 정상임을 확인하였다.
  - `fastapi`, `uvicorn`, `torch` import 성공
  - `core.config` 기준 최신 모델 설정값 확인
  - `requirements-runtime.txt` 설치 후 서버 기동 성공

### 2.8 동작 확인 방법

- FastAPI 서버 실행 후 아래 주소로 동작 여부를 확인한다.
  - `http://localhost:8000/health`
  - `http://localhost:8000/docs`
- 서버 기동 시 preload 과정에서 모델 파일 또는 추천 리소스 파일이 누락되면 startup 단계에서 즉시 실패할 수 있으므로, 에러 발생 시 `data` 경로를 우선 확인한다.

## 3. Spring 서버 실행 방법

### 3.1 대상 경로

- Spring 서버 소스 경로는 `backend` 이다.
- 실행 기준 경로는 다음과 같다.
  - `~/S14P31E104/backend`

### 3.2 필수 소프트웨어 및 버전

| 구분 | 항목 | 값 |
|---|---|---|
| JDK | Java | `17` |
| Framework | Spring Boot | `3.5.14` |
| Build Tool | Gradle | 저장소 포함 `gradlew` 사용 |
| Database | MongoDB | `7` |
| API 문서 | springdoc-openapi | `2.8.13` |

- Spring 서버는 `build.gradle` 기준으로 Java 17 toolchain 환경을 사용한다.
- 별도 Gradle 설치 없이 저장소에 포함된 `./gradlew` 스크립트로 빌드 및 실행할 수 있다.

### 3.3 환경변수 및 설정 파일

- 주요 설정 파일은 `~/S14P31E104/backend/src/main/resources/application.yaml` 이다.
- 기본 설정상 Spring 서버는 MongoDB와 FastAPI 주소를 환경변수로 주입받는다.

| 환경변수 | 기본값 | 의미 |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017/backend` | MongoDB 연결 URI |
| `SIGN2SPEECH_FASTAPI_BASE_URL` | `http://localhost:8000` | FastAPI 서버 base URL |
| `SIGN2SPEECH_FASTAPI_SIGN_TO_SPEECH_PATH` | `/sign-to-speech` | sign-to-speech 엔드포인트 |
| `SIGN2SPEECH_FASTAPI_GLOSSES_TO_SPEECH_PATH` | `/glosses-to-speech` | glosses-to-speech 엔드포인트 |
| `SIGN2SPEECH_FASTAPI_AUDIO_ASSET_PATH` | `/static/audio` | 오디오 정적 자산 경로 |
| `SIGN2SPEECH_FASTAPI_SPEECH_TO_SIGN_PATH` | `/speech-to-sign` | speech-to-sign 엔드포인트 |
| `SIGN2SPEECH_FASTAPI_TEXT_TO_SIGN_PATH` | `/text-to-sign` | text-to-sign 엔드포인트 |
| `SIGN2SPEECH_FASTAPI_GLOSS_RECOMMEND_PATH` | `/glosses/recommend` | gloss 추천 엔드포인트 |

- 로컬 개발 환경에서는 최소한 아래 두 값만 맞춰두면 된다.

```bash
export MONGODB_URI=mongodb://localhost:27017/backend
export SIGN2SPEECH_FASTAPI_BASE_URL=http://localhost:8000
```

### 3.4 Docker 설치

- MongoDB를 Docker 컨테이너로 실행할 경우, 먼저 Docker Engine이 설치되어 있어야 한다.
- Ubuntu/Linux 기준 설치 예시는 다음과 같다.

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
```

- 설치 확인:

```bash
docker --version
```

- 현재 사용자로 `sudo` 없이 Docker를 사용하려면 아래 명령을 추가로 수행한 뒤, 셸에 다시 로그인한다.

```bash
sudo usermod -aG docker $USER
```

### 3.5 MongoDB 실행

- Spring 서버 실행 전에 MongoDB가 먼저 실행 중이어야 한다.
- Docker가 설치되어 있다면 아래 명령으로 MongoDB 컨테이너를 실행한다.

```bash
docker run -d \
  --name backend-mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=backend \
  mongo:7
```

- 이미 동일한 이름의 컨테이너가 존재하면 아래 명령으로 다시 시작할 수 있다.

```bash
docker start backend-mongodb
```

- 실행 확인:

```bash
docker ps
```

- 컨테이너를 사용하지 않고 로컬 MongoDB를 직접 설치한 경우에도 `MONGODB_URI=mongodb://localhost:27017/backend` 로 접근 가능해야 한다.
- 로컬에 `mongo:7` 이미지가 없으면 Docker가 최초 실행 시 자동으로 이미지를 다운로드한다.

### 3.6 빌드 방법

- Spring 서버 빌드는 아래 명령으로 수행한다.

```bash
cd ~/S14P31E104/backend
./gradlew build -x test
```

- 테스트까지 포함하려면 다음 명령을 사용한다.

```bash
cd ~/S14P31E104/backend
./gradlew test
```

### 3.7 실행 명령어

- 로컬 개발 환경에서 Spring 서버를 실행하는 명령은 다음과 같다.

```bash
export MONGODB_URI=mongodb://localhost:27017/backend
export SIGN2SPEECH_FASTAPI_BASE_URL=http://localhost:8000
cd ~/S14P31E104/backend
./gradlew bootRun
```

- 빌드 후 jar 파일로 실행하려면 아래 명령을 사용한다.

```bash
export MONGODB_URI=mongodb://localhost:27017/backend
export SIGN2SPEECH_FASTAPI_BASE_URL=http://localhost:8000
cd ~/S14P31E104/backend
./gradlew build -x test
java -jar build/libs/backend-0.0.1-SNAPSHOT.jar
```

### 3.8 동작 확인 방법

- Spring 서버 실행 후 아래 주소로 동작 여부를 확인한다.
  - `http://localhost:8080`
  - `http://localhost:8080/swagger-ui.html`
  - `http://localhost:8080/api-docs`
- `frontend/web` 개발 서버와 연동하는 경우 `/api` 요청이 Spring 서버로 정상 전달되는지 확인한다.
- FastAPI 서버가 함께 실행 중이어야 수어/음성 변환 관련 API가 정상 응답한다.

## 4. Mobile 실행 방법

### 4.1 대상 경로

- Mobile 프론트엔드 소스 경로는 `android/frontend` 이다.
- 실행 기준 경로는 다음과 같다.
  - `~/S14P31E104/android/frontend`

- 본 프로젝트의 Mobile 앱은 `Expo SDK 54` 기반 React Native 앱이며, 진입점은 아래 파일들이다.
  - `~/S14P31E104/android/frontend/index.ts`
  - `~/S14P31E104/android/frontend/App.tsx`

### 4.2 Node.js 및 npm 버전

- Mobile 프론트엔드는 `Node.js` 와 `npm` 환경이 필요하다.
- 저장소에 `engines` 필드는 따로 선언되어 있지 않으므로, 실행 전 아래 명령으로 설치 여부를 먼저 확인한다.

```bash
node -v
npm -v
```

- 패키지 매니저는 `npm` 을 기준으로 한다.
- 주요 Mobile 런타임/빌드 패키지는 다음과 같다.

| 패키지 | 버전 |
|---|---|
| `expo` | `~54.0.33` |
| `react` | `19.1.0` |
| `react-native` | `0.81.5` |
| `expo-camera` | `~17.0.10` |
| `expo-audio` | `~1.1.1` |
| `expo-video` | `~3.0.16` |
| `react-native-vision-camera` | `^4.7.3` |
| `react-native-mediapipe` | `^0.6.0` |
| `@mediapipe/tasks-vision` | `^0.10.35` |

### 4.3 의존성 설치

- 최초 실행 시 아래 명령으로 의존성을 설치한다.

```bash
cd ~/S14P31E104/android/frontend
npm install
```

- `postinstall` 스크립트로 `patch-package` 가 자동 실행되며, `react-native-mediapipe` 패치가 함께 적용된다.
- Mobile 앱은 아래 자산/패치에 의존한다.
  - `~/S14P31E104/android/frontend/patches/react-native-mediapipe+0.6.0.patch`
  - `~/S14P31E104/android/frontend/assets/mediapipe/*.task`

### 4.4 환경 파일 생성

- Mobile 프론트엔드는 `.env.example` 을 참고하여 `.env.local` 파일을 생성해 사용한다.
- 로컬 개발 기준 예시는 다음과 같다.

```bash
cd ~/S14P31E104/android/frontend
cat <<'EOF' > .env.local
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080
EOF
```

| 환경변수 | 예시 값 | 의미 |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:8080` | Android Emulator에서 호스트 PC의 Spring 서버에 접근할 때 사용 |

- `.env.example` 에 명시된 환경별 기준은 다음과 같다.
  - Android Emulator: `http://10.0.2.2:8080`
  - Android 실기기 + 같은 LAN/핫스팟: `http://<PC LAN IP>:8080`
- Mobile 앱은 FastAPI를 직접 호출하지 않고, `EXPO_PUBLIC_API_URL` 로 지정한 Spring 서버만 호출한다.

### 4.5 개발 서버 실행

- Mobile 앱은 `Expo` 개발 서버로 실행한다.

```bash
cd ~/S14P31E104/android/frontend
npm start
```

- Android 네이티브 개발 빌드가 필요한 경우 다음 명령을 사용한다.

```bash
cd ~/S14P31E104/android/frontend
npm run android
```

- 주요 스크립트는 다음과 같다.

| 스크립트 | 명령 | 설명 |
|---|---|---|
| `start` | `expo start` | Expo 개발 서버 실행 |
| `android` | `expo run:android` | Android 네이티브 실행/빌드 |
| `ios` | `expo run:ios` | iOS 네이티브 실행/빌드 |
| `web` | `expo start --web` | Expo 웹 미리보기 |

- `app.json` 기준 주요 Mobile 실행 설정은 다음과 같다.

| 항목 | 값 | 의미 |
|---|---|---|
| `newArchEnabled` | `true` | Expo/RN New Architecture 사용 |
| `orientation` | `portrait` | 세로 화면 고정 |
| Android package | `com.devchaezerojj.frontend` | 앱 패키지명 |
| Android permissions | `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | 수어/음성 입력 기능에 필요 |

- Mobile 앱은 `expo-camera`, `react-native-vision-camera`, `react-native-mediapipe` 를 함께 사용하므로, 일반 `Expo Go` 보다 개발용 네이티브 빌드 기반 실행이 더 안정적이다.

### 4.6 빌드 방법

- 로컬 Android 네이티브 빌드는 아래 명령으로 수행한다.

```bash
cd ~/S14P31E104/android/frontend
npm run android
```

- `EAS Build` 구성을 사용할 경우 `eas.json` 기준 프로파일은 다음과 같다.

| 프로파일 | 설정 | 의미 |
|---|---|---|
| `development` | `developmentClient: true`, `distribution: internal` | 개발용 Dev Client 빌드 |
| `preview` | `distribution: internal` | 내부 테스트 배포 |
| `production` | `autoIncrement: true` | 운영 빌드 |

- 원격 빌드를 사용할 경우 예시는 다음과 같다.

```bash
cd ~/S14P31E104/android/frontend
eas build -p android --profile development
```

- Mobile 프로젝트는 `plugins/withMediaPipeAssets.js` 를 통해 prebuild 시점에 `assets/mediapipe/*.task` 파일을 `android/app/src/main/assets` 로 복사한다.
- 따라서 MediaPipe 모델 자산이 누락되면 네이티브 카메라/수어 인식 기능이 동작하지 않는다.

### 4.7 동작 확인 방법

- Mobile 프론트엔드 실행 전 Spring 서버가 먼저 실행되어 있어야 한다.
- Spring 서버가 `http://localhost:8080` 에서 실행 중이라면, Android Emulator에서는 `.env.local` 에 `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080` 을 사용한다.
- 실기기 테스트 시에는 PC와 단말이 같은 네트워크에 있어야 하며, `EXPO_PUBLIC_API_URL=http://<PC LAN IP>:8080` 형식으로 맞춘다.
- 앱 실행 후 아래 항목을 순서대로 확인한다.
  - 권한 화면에서 `카메라`, `마이크` 권한 요청이 정상 노출되는지
  - 청인 모드에서 음성 녹음 후 수어 아바타 응답이 정상 재생되는지
  - 농인 모드에서 카메라 입력 후 한국어 텍스트/음성 결과가 정상 표시되는지
  - 추천 화면에서 카테고리/글로스 선택 흐름이 정상 동작하는지
  - 네트워크 차단 시 에러 토스트 또는 fallback UI가 노출되는지

## 5. 실행에 필요한 데이터 및 자산

### 5.1 FastAPI data 디렉토리

- FastAPI 서버 실행에 필요한 런타임 데이터는 아래 경로에 배치해야 한다.
  - `~/S14P31E104/fastapi/data`
- 아래 파일 및 디렉토리가 존재해야 한다.

| 경로 | 용도 |
|---|---|
| `data/derived/checkpoints/best.pt` | sign-to-speech 모델 체크포인트 |
| `data/derived/checkpoints/seq2seq/best/` | 한국어 ↔ 글로스 변환용 seq2seq 모델 디렉토리 |
| `data/derived/vocab.json` | 글로스 vocabulary 파일 |
| `data/derived/word_db_generated.json` | 글로스와 리소스 매핑 DB |
| `data/bigram.json` | gloss recommend bigram 테이블 |
| `data/trigram.json` | gloss recommend trigram 테이블 |
| `data/starter.json` | gloss recommend starter 테이블 |
| `data/word2vec.model` | gloss recommend Word2Vec 모델 |

- 확인 예시:

```bash
cd ~/S14P31E104/fastapi
ls data
ls data/derived
ls data/derived/checkpoints
ls data/derived/checkpoints/seq2seq/best
```

### 5.2 데이터베이스 및 초기 데이터

- Spring 서버는 MongoDB 연결 정보를 필요로 한다.
- 로컬 개발 기준 기본 URI는 다음과 같다.

```bash
mongodb://localhost:27017/backend
```

- MongoDB를 Docker 컨테이너로 실행하는 경우 아래 명령으로 준비한다.

```bash
docker run -d \
  --name backend-mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=backend \
  mongo:7
```

- 이미 컨테이너가 존재하면 다음 명령으로 재시작한다.

```bash
docker start backend-mongodb
```

- 실행 확인:

```bash
docker ps
```

- DB 덤프 또는 초기 데이터가 별도로 제공되는 경우, 복원 후 `backend` 데이터베이스에 정상 반영되었는지 확인한다.

### 5.3 기타 정적 자산

- Spring 서버 자체는 추가 정적 자산 없이 실행 가능하다.
- FastAPI 서버는 `data` 디렉토리 내부 자산 외에 별도 모델/추천 리소스가 누락되면 startup 단계에서 실패할 수 있다.

## 6. 전체 실행 순서

### 6.1 FastAPI 서버 실행

- 먼저 FastAPI 런타임 데이터가 아래 경로에 정상 배치되어 있는지 확인한다.
  - `~/S14P31E104/fastapi/data`
- 이후 아래 명령으로 FastAPI 서버를 실행한다.

```bash
conda activate sonpyeonji-ai
cd ~/S14P31E104/fastapi
export LKS_PROFILE=runpod
export LKS_PRELOAD_MODELS=1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 6.2 Spring 서버 실행

- MongoDB가 먼저 실행 중인지 확인한 뒤 Spring 서버를 실행한다.

```bash
export MONGODB_URI=mongodb://localhost:27017/backend
export SIGN2SPEECH_FASTAPI_BASE_URL=http://localhost:8000
cd ~/S14P31E104/backend
./gradlew bootRun
```

### 6.3 Mobile 실행

- Mobile 프론트엔드는 아래 명령으로 실행한다.

```bash
cd ~/S14P31E104/android/frontend
npm install
npm start
```

- Android Emulator에서 바로 네이티브 실행까지 포함하려면 다음 명령을 사용한다.

```bash
cd ~/S14P31E104/android/frontend
npm run android
```

- 실행 전 `.env.local` 의 `EXPO_PUBLIC_API_URL` 값이 현재 테스트 환경과 일치해야 한다.
  - Emulator: `http://10.0.2.2:8080`
  - 실기기: `http://<PC LAN IP>:8080`

### 6.4 연동 확인

- FastAPI 서버 확인
  - `http://localhost:8000/health`
  - `http://localhost:8000/docs`
- Spring 서버 확인
  - `http://localhost:8080`
  - `http://localhost:8080/swagger-ui.html`
  - `http://localhost:8080/api-docs`
- Spring 서버가 FastAPI 서버와 통신 가능한지 확인한다.
  - `SIGN2SPEECH_FASTAPI_BASE_URL=http://localhost:8000`
- MongoDB가 실행 중인지 확인한다.
  - `docker ps`

## 7. 배포 시 특이사항

### 7.1 경로 및 환경변수 주의사항

- 본 문서는 `~/S14P31E104` 경로를 기준으로 작성되었다.
- 실제 clone 경로가 다를 경우, 문서에 기재된 모든 실행 경로를 동일한 기준으로 변경해야 한다.
- 특히 아래 경로는 실제 기능 동작과 직접 연결되므로 정확한 위치를 유지해야 한다.
  - `~/S14P31E104/fastapi`
  - `~/S14P31E104/fastapi/data`
  - `~/S14P31E104/backend`
- 필수 환경변수:
  - `MONGODB_URI`
  - `SIGN2SPEECH_FASTAPI_BASE_URL`
  - `LKS_PROFILE`
  - `LKS_PRELOAD_MODELS`

### 7.2 포트 충돌 주의사항

- 기본 개발 포트는 다음과 같다.

| 구성요소 | 포트 |
|---|---|
| FastAPI | `8000` |
| Spring Boot | `8080` |
| MongoDB | `27017` |

- Docker Compose 기반 배포 시 Spring 컨테이너는 외부 `8081` 포트로 매핑될 수 있으므로, 로컬 개발 포트와 혼동하지 않도록 주의한다.
- 이미 다른 프로세스가 동일 포트를 사용 중이면 서버 기동에 실패할 수 있다.

### 7.3 FastAPI 연동 장애 시 확인 사항

- Spring 서버가 실행되더라도 `SIGN2SPEECH_FASTAPI_BASE_URL` 이 잘못되면 변환 API 호출이 실패한다.
- 우선 확인할 항목:
  - FastAPI 서버가 `8000` 포트에서 기동 중인지
  - `http://localhost:8000/health` 응답이 정상인지
  - `data` 디렉토리와 체크포인트 파일이 정상 배치되어 있는지
  - preload 단계에서 `bigram.json`, `trigram.json`, `starter.json`, `word2vec.model` 누락이 없는지

### 7.4 데이터 및 모델 파일 누락 시 확인 사항

- FastAPI 서버는 모델 파일 또는 추천 리소스 파일이 누락되면 startup 단계에서 즉시 실패할 수 있다.
- 대표적인 확인 경로:
  - `~/S14P31E104/fastapi/data/derived/checkpoints/best.pt`
  - `~/S14P31E104/fastapi/data/derived/checkpoints/seq2seq/best/`
  - `~/S14P31E104/fastapi/data/bigram.json`
  - `~/S14P31E104/fastapi/data/trigram.json`
  - `~/S14P31E104/fastapi/data/starter.json`
  - `~/S14P31E104/fastapi/data/word2vec.model`
- Spring 서버는 MongoDB가 내려가 있거나 `MONGODB_URI` 가 잘못되면 기동 또는 기능 동작에 실패할 수 있다.

## 8. 주요 설정 파일 목록

### 8.1 FastAPI 설정 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/fastapi/requirements-runtime.txt` | FastAPI 실행용 Python 의존성 목록 | 실행 검증 기준 파일 |
| `~/S14P31E104/fastapi/app/main.py` | FastAPI 앱 진입점 | lifespan startup 포함 |
| `~/S14P31E104/fastapi/app/container.py` | 런타임 컨테이너 및 preload 로직 | 추천 리소스 및 모델 로드 |
| `~/S14P31E104/fastapi/core/config.py` | 데이터/모델/학습 경로 설정 | `DATA_DIR`, `CHECKPOINTS_DIR` 포함 |
| `~/S14P31E104/fastapi/data/derived/checkpoints/best.pt` | sign-to-speech 모델 체크포인트 | 필수 런타임 자산 |
| `~/S14P31E104/fastapi/data/derived/checkpoints/seq2seq/best/` | seq2seq 모델 디렉토리 | 필수 런타임 자산 |

### 8.2 Spring 설정 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/backend/build.gradle` | Spring 빌드 설정 | Java 17, Spring Boot 3.5.14 |
| `~/S14P31E104/backend/src/main/resources/application.yaml` | Spring 런타임 설정 | MongoDB URI, FastAPI base URL 포함 |
| `~/S14P31E104/backend/docker-compose.yml` | 컨테이너 기반 배포 설정 | backend + mongodb 구성 |
| `~/S14P31E104/backend/gradlew` | Gradle wrapper 실행 파일 | 별도 Gradle 설치 없이 사용 |

### 8.3 Mobile 설정 파일

| 파일 경로 | 용도 | 비고 |
|---|---|---|
| `~/S14P31E104/android/frontend/package.json` | Expo 스크립트 및 Mobile 의존성 정의 | `start`, `android`, `ios`, `postinstall` 포함 |
| `~/S14P31E104/android/frontend/app.json` | Expo 앱 설정 | 권한, 패키지명, plugins 정의 |
| `~/S14P31E104/android/frontend/.env.example` | Mobile API 환경변수 예시 | `EXPO_PUBLIC_API_URL` 설명 포함 |
| `~/S14P31E104/android/frontend/index.ts` | Expo 루트 등록 진입점 | `registerRootComponent(App)` |
| `~/S14P31E104/android/frontend/App.tsx` | 앱 최상위 컴포넌트 | NavigationContainer, SafeAreaProvider 구성 |
| `~/S14P31E104/android/frontend/eas.json` | EAS Build 프로파일 정의 | `development`, `preview`, `production` |
| `~/S14P31E104/android/frontend/babel.config.js` | Babel 설정 | `module-resolver`, `react-native-reanimated/plugin` 포함 |
| `~/S14P31E104/android/frontend/metro.config.js` | Metro 번들러 설정 | `glb`, `gltf`, `bin` asset 확장자 허용 |
| `~/S14P31E104/android/frontend/plugins/withMediaPipeAssets.js` | Android prebuild 시 MediaPipe `.task` 파일 복사 | 네이티브 MediaPipe 로딩에 필수 |
| `~/S14P31E104/android/frontend/src/constants/api.ts` | Spring API endpoint 상수 | FastAPI 직접 호출 금지 정책 반영 |
| `~/S14P31E104/android/frontend/src/lib/api/client.ts` | Mobile fetch wrapper | `EXPO_PUBLIC_API_URL` 사용, timeout 처리 포함 |
