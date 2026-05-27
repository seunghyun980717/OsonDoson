# Get Started

현재 보유한 AIHub keypoint zip 기준으로 CTC split CSV를 새로 만들고, 그 split으로 학습/검증하는 기본 순서입니다.
이 split은 `SENxxxx` 문장 ID 기준으로 train/val을 나누므로, 같은 문장이 train과 val에 동시에 들어가지 않습니다.

주의:
- 아래 명령은 `numpy`, `torch`, `transformers` 등이 설치된 학습용 가상환경에서 실행해야 합니다.
- `python -m sign_to_speech.build_available_split`를 한 번 실행하면 `LKS/data/derived/splits/available_train.csv`, `available_val.csv`가 생성되고, 이후 CTC 코드는 이 파일들을 자동으로 우선 사용합니다.
- 생성 보고서 `available_split_report.json`에서 `sentence_group_overlap=0`인지 확인하시면 됩니다.

## 1. CTC split 생성

```bash
cd LKS/poc
python -m sign_to_speech.build_available_split
```

생성 파일:

```text
LKS/data/derived/splits/available_train.csv
LKS/data/derived/splits/available_val.csv
LKS/data/derived/splits/available_split_report.json
```

현재 생성 기준:
- train/val 모두 `1.Training + 2.Validation`에 있는 실제 keypoint zip 전체를 스캔합니다.
- 공식 CSV에 라벨이 있는 샘플만 사용합니다.
- `SENxxxx` 문장 ID를 그룹으로 묶어 train/val을 다시 분할합니다.
- 공식 CSV에 라벨이 없는 `D/L/R/U` 뷰는 제외되고, 현재는 라벨이 있는 `F` 뷰 중심으로 사용됩니다.

## 2. CTC cache 생성

```bash
cd LKS/poc
python -m sign_to_speech.precache --split train
python -m sign_to_speech.precache --split val
```

## 3. Token segment manifest 생성

sentence morpheme의 `start/end frame`을 읽어서 token auxiliary supervision용 manifest를 만듭니다.

```bash
cd LKS/poc
python -m sign_to_speech.build_segment_manifest
```

생성 파일:

```text
LKS/data/derived/segment_manifests/train_segments.json
LKS/data/derived/segment_manifests/val_segments.json
```

`sign_to_speech.train` 실행 시 manifest가 없으면 자동으로 생성합니다.

## 4. CTC 학습

```bash
cd LKS/poc
python -m sign_to_speech.train --epochs 50 --batch_size 128
python -m sign_to_speech.train --epochs 50 --batch_size 128 --resume
```

현재 CTC 모델은 단순 LSTM이 아니라 경량 Conformer-style encoder를 사용하고,
sentence-level CTC loss와 morpheme segment 기반 token auxiliary loss를 함께 학습합니다.

## 5. CTC 검증 CSV 생성

```bash
cd LKS/poc
python -m sign_to_speech.evaluate --split val
```

기본 결과 파일:

```text
LKS/data/derived/checkpoints/eval/best_val_predictions.csv
```

## 6. Seq2Seq 데이터 생성 및 학습

```bash
cd LKS/poc
python -m seq2seq.data_builder
python -m seq2seq.train --epochs 100 --batch_size 128
```

## 7. Seq2Seq 검증 CSV 생성

```bash
cd LKS/poc
python -m seq2seq.evaluate
```

기본 결과 파일:

```text
LKS/data/derived/checkpoints/seq2seq/eval/val_g2k_predictions.csv
LKS/data/derived/checkpoints/seq2seq/eval/val_k2g_predictions.csv
```

# Sign Language Translation Project

농인-청인 양방향 수어 번역 프로젝트의 1차 리팩토링 기준 문서입니다.

사용자 인터뷰 기반 설계 요약은 [user_interview_summary.md](C:/SSAFY/E104/S14P31E104/LKS/poc/docs/user_interview_summary.md)에서 확인할 수 있습니다.

- `LKS/runtime`: Jetson Orin Nano 배포용 런타임
- `LKS/core`: runtime/research 공통 로직
- `LKS/poc`: 학습, 평가, 데이터 빌드, 데모, 검증 코드
- `dashbord/`: 변환 로직 검증용 보조 프로젝트. 최종 배포 경로는 아님

최종 목표는 Spring 기반 서버가 아니라 Jetson Orin Nano 단일 장비에서 동작하는 Python 기반 파이프라인입니다.

## 구조

```text
LKS/
├── core/
│   ├── config.py
│   ├── data_utils/
│   ├── seq2seq/
│   └── sign_to_speech/
├── runtime/
│   ├── api/
│   ├── sign_to_speech/
│   └── speech_to_sign/
├── poc/
│   ├── data_utils/
│   ├── seq2seq/
│   ├── sign_to_speech/
│   ├── speech_to_sign/
│   ├── demo_sign_to_speech.py
│   ├── demo_speech_to_sign.py
│   └── test_ctc.py
└── data/
    ├── external/
    ├── raw/
    └── derived/
```

## 역할 분리

### 1. runtime

Jetson Orin Nano에 올릴 실제 서비스 코드입니다.

- FastAPI 엔트리포인트
- Sign-to-Speech, Speech-to-Sign 추론
- MediaPipe video -> keypoint 변환
- T5 기반 번역 추론

`runtime`은 더 이상 `poc`의 seq2seq 추론 모듈에 직접 의존하지 않습니다. T5 추론은 `core.seq2seq`를 통해 공유합니다.

### 2. core

공통 로직만 둡니다.

- 경로/환경 설정
- keypoint 변환 및 로드
- CTC 모델 정의
- T5 추론 공용 모듈
- 한글/글로스 공통 유틸

### 3. poc

검증 및 연구 코드만 둡니다.

- CTC 학습/평가/캐시 생성
- seq2seq 학습/평가/데이터 빌드
- word_db, jamo_db 구축
- 샘플/데모 실행

## 데이터 구조

모든 데이터는 `LKS/data` 아래에서 관리합니다.

```text
LKS/data/
├── external/
│   ├── aihub_sign/
│   └── GKSL-dataset/
├── raw/
└── derived/
    ├── cache/
    ├── checkpoints/
    ├── outputs/
    ├── seq2seq/
    ├── word_clips/
    ├── vocab.json
    └── word_db.json
```

공통 경로 정의는 [config.py](C:/SSAFY/E104/S14P31E104/LKS/core/config.py)에서 관리합니다.

### 실제 사용 데이터

#### AIHub 수어 영상

위치:

```text
LKS/data/external/aihub_sign/
```

주요 참조 파일:

| 구분 | 경로 | 용도 |
|---|---|---|
| 문장 keypoint train | `1.Training/[라벨]01_real_sen_keypoint.zip` | CTC 학습 입력 |
| 문장 keypoint val | `2.Validation/[라벨]09_real_sen_keypoint.zip` | CTC 검증 입력 |
| crowd keypoint | `2.Validation/[라벨]01_crowd_keypoint.zip` | 확장 실험 |
| synthetic sentence keypoint | `2.Validation/[라벨]02_syn_sen_keypoint.zip` | 확장 실험 |
| real word keypoint | `2.Validation/[라벨]09_real_word_keypoint.zip` | 단어 단위 실험 |
| synthetic word keypoint | `2.Validation/[라벨]02_syn_word_keypoint.zip` | 단어 단위 실험 |
| 문장 morpheme train | `1.Training/[라벨]01_real_sen_morpheme.zip` | CTC 정답 라벨 |
| 문장 morpheme val | `2.Validation/[라벨]09_real_sen_morpheme.zip` | CTC 검증 라벨 |
| 단어 morpheme | `2.Validation/[라벨]01_real_word_morpheme.zip` | `word_db.json` 구축 |
| 단어 video | `2.Validation/[원천]01_real_word_video.zip` | word clip 추출 |
| 문장 video train | `1.Training/[원천]01_real_sen_video.zip` | 원본 참조 |
| 문장 video val | `2.Validation/[원천]09_real_sen_video.zip` | 원본 참조 |
| split CSV train | `03.AI모델/03.AI모델/NIA_SEN_train.csv` | CTC split |
| split CSV val | `03.AI모델/03.AI모델/NIA_SEN_val.csv` | CTC split |

#### GKSL dataset

위치:

```text
LKS/data/external/GKSL-dataset/
```

사용 파일:

| 파일 | 용도 |
|---|---|
| `dataset/GKSL3k_original.csv` | 원본 병렬 데이터 |
| `dataset/GKSL13k_augmented.csv` | 증강 병렬 데이터 |

#### 로컬 샘플

위치:

```text
LKS/data/raw/
```

현재 샘플:

| 경로 | 용도 |
|---|---|
| `video/NIA_SL_SEN1196_REAL17_F.mp4` | 단일 비디오 디버깅 |
| `morpheme_json/NIA_SL_SEN1196_REAL17_F_morpheme.json` | 대응 morpheme |
| `keypoint_json/NIA_SL_SEN1196_REAL17_F/` | 대응 keypoint JSON |

## 설치

### Jetson Orin Nano 런타임 기본 설치

```bash
cd LKS
pip install -r requirements-runtime.txt
```

이 조합은 기본 배포 기준인 `TRANSLATION_BACKEND="t5"`를 전제로 합니다.

런타임은 CUDA 사용이 가능하면 CTC 모델을 자동으로 GPU에 올립니다. 배포 장비에서 `/health` 응답의 `device` 필드로 실제 인식 장치를 확인하시면 됩니다.

### LLM/RAG 기능까지 포함한 런타임 설치

```bash
cd LKS
pip install -r requirements-runtime-llm.txt
```

추가 대상:

- `openai`
- `sentence-transformers`

이 조합은 `ollama` 또는 `openai` 번역 백엔드를 쓸 때 필요합니다.

### 연구/학습 환경 설치

```bash
cd LKS
pip install -r requirements-research.txt
```

`LKS/poc/requirements.txt`는 연구 환경 설치용 호환 파일입니다.

### ffmpeg

```bash
# Windows
winget install ffmpeg

# macOS
brew install ffmpeg
```

## 번역 백엔드

[config.py](C:/SSAFY/E104/S14P31E104/LKS/core/config.py)에서 설정합니다.

```python
TRANSLATION_BACKEND = "t5"  # "t5" | "ollama" | "openai"
```

| 값 | 설명 | 추가 의존성 |
|---|---|---|
| `t5` | fine-tuned `pko-t5-small` | 없음 |
| `ollama` | 로컬 LLM + RAG | `requirements-runtime-llm.txt` |
| `openai` | OpenAI API + RAG | `requirements-runtime-llm.txt` |

현재 코드 기준으로 `t5` 모드에서는 서버 시작 시 RAG 인덱스를 로드하지 않습니다.

## 실행

### 런타임 API

```bash
cd LKS
uvicorn runtime.api.main:app --host 0.0.0.0 --port 8000 --reload
```

- Swagger: `http://localhost:8000/docs`
- Demo: `http://localhost:8000/demo`
- Health: `http://localhost:8000/health`

### word_db 구축

```bash
cd LKS/poc
python -m data_utils.word_db_builder
```

### vocab/RAG 준비

```bash
cd LKS/poc
python -c "from sign_to_speech.dataset import get_or_build_vocab; get_or_build_vocab()"
python -m data_utils.gloss_retriever
```

`t5`만 쓸 경우 RAG 인덱스는 런타임 필수 조건이 아닙니다.

### CTC cache 생성

```bash
cd LKS/poc
python -m sign_to_speech.precache
```

### CTC 학습

```bash
cd LKS/poc
python -m sign_to_speech.train --epochs 50 --batch_size 128
python -m sign_to_speech.train --epochs 50 --batch_size 128 --resume
```

### seq2seq 학습

```bash
cd LKS/poc
python -m seq2seq.data_builder
python -m seq2seq.train --epochs 100 --batch_size 128
python -m seq2seq.evaluate
```

## 주요 파이프라인

### Sign-to-Speech

```text
수어 영상
  -> MediaPipe Holistic
  -> OpenPose 호환 134차원 keypoint
  -> Bi-LSTM + CTC
  -> gloss 시퀀스
  -> T5 또는 LLM
  -> 한국어
  -> TTS
```

### Speech-to-Sign

```text
음성/텍스트
  -> Whisper STT
  -> 한국어
  -> T5 또는 RAG + LLM
  -> gloss 시퀀스
  -> word_db / jamo_db
  -> ffmpeg concat
  -> 수어 영상
```

### 최종 변환 경로

Jetson Orin Nano 배포 기준 변환 경로는 아래 Python 모듈입니다.

- `core/data_utils/video_to_keypoints.py`
- `core/data_utils/mediapipe_converter.py`
- `core/data_utils/keypoint_loader.py`

`dashbord/converter`, `dashbord/converter_front`는 검증용이며 최종 배포 경로로 사용하지 않습니다.

## 생성 파일

| 경로 | 생성 방법 |
|---|---|
| `LKS/data/derived/word_clips/` | `python -m data_utils.word_db_builder` |
| `LKS/data/derived/word_db.json` | `python -m data_utils.word_db_builder` |
| `LKS/data/derived/jamo_db.json` | `python -m data_utils.jamo_db_builder` |
| `LKS/data/derived/cache/` | `python -m sign_to_speech.precache` |
| `LKS/data/derived/vocab.json` | `get_or_build_vocab()` |
| `LKS/data/derived/checkpoints/` | `sign_to_speech.train`, `seq2seq.train` |
| `LKS/data/derived/seq2seq/gksl_pairs.json` | `python -m seq2seq.data_builder` |
| `LKS/data/derived/outputs/output_sign.mp4` | API/demo 실행 결과 |
| `LKS/runtime/api/app/static/audio/*.mp3` | TTS 결과 |

원본 데이터와 파생 산출물은 [LKS/.gitignore](C:/SSAFY/E104/S14P31E104/LKS/.gitignore)에서 제외합니다.

## 현재 한계

- gloss-only 파이프라인만으로 KSL 문법 차이를 완전히 복원하기는 어렵습니다.
- `StreamingDecoder`는 아직 실험용 구조입니다.
- `word_db`에 없는 gloss는 영상 생성이 제한됩니다.
- 학습/검증 성능은 현재 캐시 범위와 체크포인트 상태에 크게 좌우됩니다.

## Validation CSV

학습이 끝난 뒤에는 각 모델별 검증셋 예측 결과를 CSV로 저장해서 눈으로 확인할 수 있습니다.

### Sign-to-Speech (CTC)

검증셋 전체 평가와 CSV 저장:

```bash
cd LKS/poc
python -m sign_to_speech.evaluate --split val
```

기본 저장 경로:

```text
LKS/data/derived/checkpoints/eval/best_val_predictions.csv
```

원하시면 경로를 직접 지정할 수 있습니다.

```bash
python -m sign_to_speech.evaluate --split val --export_csv C:/SSAFY/E104/S14P31E104/LKS/data/derived/checkpoints/eval/ctc_val_predictions.csv
```

CSV 컬럼:

```text
sample_id, split, pred_gloss, target_gloss, exact_match, sample_wer, sample_f1
```

### Seq2Seq

검증셋 전체 평가와 CSV 저장:

```bash
cd LKS/poc
python -m seq2seq.evaluate
```

기본 저장 경로:

```text
LKS/data/derived/checkpoints/seq2seq/eval/val_g2k_predictions.csv
LKS/data/derived/checkpoints/seq2seq/eval/val_k2g_predictions.csv
```

원하시면 디렉터리를 직접 지정할 수 있습니다.

```bash
python -m seq2seq.evaluate --export_dir C:/SSAFY/E104/S14P31E104/LKS/data/derived/checkpoints/seq2seq/eval
```

CSV 컬럼:

```text
sample_id, task, input_text, target_text, pred_text, exact_match, token_f1
```
