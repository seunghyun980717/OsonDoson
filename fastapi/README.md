# LKS MVP Server

`LKS`는 수어 번역 MVP 서버와 관련 학습 코드를 한 저장소에 정리한 프로젝트입니다. 현재 기준 진입점은 [`app/main.py`](/C:/SSAFY/E104/S14P31E104/LKS/app/main.py)이고, 서버는 FastAPI, 연구/학습은 `poc/seq2seq`를 중심으로 구성했습니다.

## 목표

- `RunPod`와 `Jetson`을 모두 염두에 둔 공용 FastAPI 구조 유지
- `speech-to-sign`, `sign-to-speech`를 같은 서버에서 운영
- `GKSL + 말뭉치(malmoongchi)` 기반 `seq2seq` 재학습 파이프라인 정리
- `train/val/test leakage`가 없도록 데이터셋 분리 재설계

## 프로젝트 구조

- `app/`
  - FastAPI 앱, 라우터, 서비스, 런타임 설정
- `core/`
  - 공통 추론 코드와 설정
  - `core/seq2seq/infer.py`는 서버와 연구 코드가 함께 쓰는 T5 추론기
- `runtime/`
  - 기존 호환 레이어와 모듈
- `poc/seq2seq/`
  - 데이터셋 빌더, 학습, 평가, 연구용 진입점
- `data/derived/`
  - 체크포인트, 캐시, word clips, seq2seq 산출물
- `tests/`
  - 단위 테스트와 API smoke 테스트
- `deploy/runpod/`
  - RunPod용 Dockerfile

## API 엔드포인트

- `GET /health`
- `POST /speech-to-sign/text`
- `POST /speech-to-sign/audio`
- `GET /sign-to-speech/samples`
- `POST /sign-to-speech/sample`
- `POST /sign-to-speech/npy`
- `POST /sign-to-speech/gloss`
- `POST /sign-to-speech/video`
- `POST /inference/record`

Swagger:

- [Swagger UI](http://127.0.0.1:8000/docs)
- [OpenAPI JSON](http://127.0.0.1:8000/openapi.json)

## 준비

권장 버전:

- `Python 3.10`
- `conda`

필수 데이터/자산:

- `data/derived/checkpoints/best.pt`
  - sign-to-speech CTC 체크포인트
- `data/derived/checkpoints/seq2seq/best/*`
  - 운영용 seq2seq 체크포인트
- `data/derived/word_db.json`
- `data/derived/word_clips/*.mp4`
- `data/derived/cache/*.npy`
- `data/external/GKSL-dataset`
- `data/external/malmoongchi/*.zip`

## conda 환경 생성

```powershell
cd C:\SSAFY\E104\S14P31E104\LKS
conda create -n sonpyeonji-ai python=3.10 -y
conda activate sonpyeonji-ai
python -m pip install --upgrade pip
```

의존성 설치:

```powershell
conda activate sonpyeonji-ai
pip install -r requirements-mvp.txt
pip install -r requirements-research.txt
```

영상 입력까지 테스트할 때만 추가:

```powershell
conda activate sonpyeonji-ai
pip install opencv-python mediapipe==0.10.9
```

## 서버 실행

기본 진입점:

```powershell
conda activate sonpyeonji-ai
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

기존 호환 진입점:

```powershell
conda activate sonpyeonji-ai
uvicorn runtime.api.main:app --host 0.0.0.0 --port 8000
```

프로파일 예시:

```powershell
conda activate sonpyeonji-ai
$env:LKS_PROFILE="runpod"
$env:LKS_PRELOAD_MODELS="1"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

주요 환경 변수:

- `LKS_PROFILE=local|runpod|jetson`
- `LKS_PRELOAD_MODELS=0|1`
- `LKS_ENABLE_TTS=0|1`
- `LKS_ENABLE_STT=0|1`
- `LKS_WORD_DB_MODE=legacy|generated`
- `LKS_WORD_DB_PATH=/absolute/path/to/word_db.json`
- `LKS_HOST`
- `LKS_PORT`

생성한 대표 clip 사전으로 서버를 띄우려면:

```powershell
conda activate sonpyeonji-ai
$env:LKS_WORD_DB_MODE="generated"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 바로 해볼 테스트

1. 서버 실행
2. [Swagger UI](http://127.0.0.1:8000/docs) 접속
3. `GET /health` 실행
4. `POST /speech-to-sign/text`에 예시 문장 입력
5. `POST /sign-to-speech/sample` 실행

## seq2seq 데이터 재설계

핵심 원칙:

- example 단위 random split 금지
- `normalized Korean`과 `normalized gloss`를 노드로 보고 연결 컴포넌트 단위로 split
- 같은 한국어 문장, 같은 gloss 문장, 같은 pair는 반드시 같은 split에만 존재
- 말뭉치 원본 gloss는 정규화 후 서비스 vocabulary(`word_db`) 기준으로 필터링 가능

산출물:

- [`data/derived/seq2seq/dataset.json`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/seq2seq/dataset.json)
- [`data/derived/seq2seq/dataset_report.json`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/seq2seq/dataset_report.json)

생성 명령:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.data_builder --stats
```

기본값은 `full gloss` 학습 데이터입니다.
즉 학습용 target은 말뭉치 원래 gloss를 유지하고, runtime 사전 투영은 별도 필드로 같이 저장합니다.

옵션 예시:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.data_builder --limit-malmoongchi-files 200 --stats
python -m poc.seq2seq.data_builder --gksl-only --stats
python -m poc.seq2seq.data_builder --malmoongchi-only --stats
python -m poc.seq2seq.data_builder --filter-word-db --stats
```

현재 구현 기준 누수 검사:

- `component_overlap == 0`
- `korean_overlap == 0`
- `gloss_overlap == 0`
- `pair_overlap == 0`

## gloss clip 재생성

AIHub + 말뭉치 전체를 기준으로 대표 clip 후보를 다시 뽑고 새 사전을 만들 수 있습니다.

산출물:

- [`data/derived/gloss_candidate_manifest.json`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/gloss_candidate_manifest.json)
- [`data/derived/word_clips_generated/`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/word_clips_generated)
- [`data/derived/word_db_generated.json`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/word_db_generated.json)
- [`data/derived/word_keypoint_clips_generated/`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/word_keypoint_clips_generated)
- [`data/derived/word_keypoint_db_generated.json`](/C:/SSAFY/E104/S14P31E104/LKS/data/derived/word_keypoint_db_generated.json)

전체 후보 manifest 생성:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_clips.py --scan-only
```

기존 manifest 재사용해서 clip 추출:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_clips.py --reuse-manifest
```

샘플 검증용 소량 추출:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_clips.py --reuse-manifest --extract-limit 30 --max-glosses 30
```

말뭉치 전체 gloss inventory 생성:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_inventory.py
```

대표 gloss 기준 keypoint clip JSON 생성:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_keypoint_clips.py
```

샘플 검증:

```powershell
conda activate sonpyeonji-ai
python scripts/build_gloss_keypoint_clips.py --limit 20
```

출력 예:

- `word_keypoint_clips_generated/나무.json`
- `word_keypoint_clips_generated/버스.json`

포맷은 말뭉치 `landmarks` 스타일을 따릅니다.

## seq2seq 학습

운영용 전체 학습:

```powershell
conda activate sonpyeonji-ai
$env:LKS_WORD_DB_MODE="generated"
python -m poc.seq2seq.train --epochs 10 --batch-size 16
```

짧은 smoke 학습:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.train `
  --epochs 1 `
  --batch-size 4 `
  --max-train-samples 64 `
  --max-val-samples 32 `
  --output-dir data/derived/checkpoints/seq2seq_smoke
```

재개:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.train --resume
```

## seq2seq 평가

운영 모델 평가:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.evaluate --split val
python -m poc.seq2seq.evaluate --split test
```

smoke 모델 평가:

```powershell
conda activate sonpyeonji-ai
python -m poc.seq2seq.evaluate `
  --split val `
  --limit 8 `
  --model-dir data/derived/checkpoints/seq2seq_smoke/best `
  --export-dir data/derived/checkpoints/seq2seq_smoke/eval
```

평가 지표:

- `g2k`: BLEU, ROUGE-L, Exact Match
- `k2g`: Precision, Recall, F1, Exact Match, Vocab Coverage

## 테스트

단위 테스트:

```powershell
conda activate sonpyeonji-ai
pytest tests/unit -q
```

API smoke 테스트:

```powershell
conda activate sonpyeonji-ai
pytest tests/integration -q
```

전체 기본 검증:

```powershell
conda activate sonpyeonji-ai
pytest tests/unit tests/integration -q
python -m py_compile poc/seq2seq/data_builder.py poc/seq2seq/train.py poc/seq2seq/evaluate.py core/seq2seq/infer.py
```

성능 smoke:

```powershell
conda activate sonpyeonji-ai
python scripts/perf_smoke.py --runs 3
```

## RunPod 배포

이미지 빌드:

```powershell
cd C:\SSAFY\E104\S14P31E104\LKS
docker build -f deploy/runpod/Dockerfile -t lks-mvp:latest .
```

실행 예시:

```powershell
docker run --rm -p 8000:8000 -e LKS_PROFILE=runpod lks-mvp:latest
```

## 이번 재설계에서 바뀐 점

- `poc/seq2seq/data_builder.py`
  - GKSL + 말뭉치를 합쳐 leakage-free split으로 dataset 생성
- `poc/seq2seq/train.py`
  - 새 dataset 포맷과 `--output-dir` 지원
- `poc/seq2seq/evaluate.py`
  - `val/test`, `--model-dir`, `--limit` 지원
- `core/seq2seq/infer.py`
  - 학습용 prefix와 동일한 prefix로 추론 통일
- `tests/unit/test_seq2seq_builder.py`
  - split overlap 방지 로직 테스트 추가

## 현재 확인된 한계

- 전체 seq2seq 품질은 아직 본격 학습 전이라 바로 높지 않습니다.
- 짧은 1 epoch smoke 학습은 파이프라인 확인용이지 품질 검증용이 아닙니다.
- `speech-to-sign/audio`는 Whisper 자산과 네트워크/디스크 상태 영향을 받습니다.
- `sign-to-speech/video`는 MediaPipe 환경이 별도로 준비돼야 합니다.
