# 수어 Keypoint 변환기

AIHub의 프레임별 keypoint 데이터와 말뭉치의 통합 keypoint 데이터를 단어 단위 JSON으로 변환하는 도구입니다.

## 담당 범위

- AIHub keypoint 폴더와 morpheme JSON을 읽습니다.
- 말뭉치 JSON 폴더를 순회합니다.
- AIHub는 폴더명이 `_F`로 끝나는 정면 데이터만 사용합니다.
- 단어 시작/끝 구간에 맞춰 프레임을 자릅니다.
- 2D keypoint 좌표는 정규화하지 않고 pixel 좌표 그대로 저장합니다.
- 원본에 calibrated 3D가 있으면 보존합니다.
- 3D가 없으면 렌더링용 `depth_hint`를 생성합니다.
- 단어별 결과 파일을 `../data/words/` 아래에 저장합니다.
- 단어 파일에는 대표 `sample` 하나만 유지합니다.

## 대표 sample 선택 정책

단어마다 하나의 대표 sample만 저장합니다.

```text
AIHub_F > corpus
```

- 기존 sample이 말뭉치이고 새 sample이 AIHub_F이면 교체합니다.
- 기존 sample이 AIHub_F이면 새 말뭉치 sample이 들어와도 유지합니다.
- 같은 등급끼리는 기존 sample을 유지합니다.

## 입력 방식

### AIHub 데이터

AIHub 데이터는 keypoint root와 morpheme root를 폴더 단위로 전달합니다.

```sh
node build-word-json.mjs \
  --type aihub \
  --keypoint-root "D:\ssafy\3_자율\수어 영상\1.Training\[라벨]01_real_sen_keypoint" \
  --morpheme-root "D:\ssafy\3_자율\수어 영상\1.Training\[라벨]01_real_sen_morpheme\morpheme" \
  --output "..\data\words" \
  --concurrency 32
```

예시 매칭:

```text
keypoint:
[라벨]01_real_sen_keypoint\01\NIA_SL_SEN0001_REAL01_F

morpheme:
[라벨]01_real_sen_morpheme\morpheme\01\NIA_SL_SEN0001_REAL01_F_morpheme.json
```

`_D`, `_L`, `_R`, `_U` 방향 데이터는 변환 대상에서 제외합니다.

### 말뭉치 데이터

말뭉치 데이터는 JSON 파일들이 들어 있는 폴더를 전달합니다.

```sh
node build-word-json.mjs \
  --type corpus \
  --corpus-dir "C:\Users\SSAFY\Downloads\corpus-json-folder" \
  --output "..\data\words" \
  --concurrency 32
```

### 출력 경로

`--output`을 생략하면 기본 출력 경로는 아래와 같습니다.

```text
..\data\words
```

생성 결과는 단어별로 저장됩니다.

```text
..\data\words\{단어}.json
```

변환 리포트는 output 폴더의 형제 폴더인 `reports`에 저장됩니다.

```text
..\data\reports
```

### 병렬 처리

`--concurrency`는 동시에 처리할 파일 작업 수입니다. 기본값은 `32`입니다.

- AIHub는 morpheme 구간을 먼저 계산한 뒤 필요한 프레임 JSON만 제한 병렬로 읽습니다.
- 말뭉치는 폴더 안의 JSON 파일을 제한 병렬로 처리합니다.

## 구현 구성

```text
build-word-json.mjs  변환 실행 스크립트
docs/                컨버터 설계 문서
```

1차 구현은 파일을 나누지 않고 `build-word-json.mjs` 안에서 함수 단위로 구분합니다.

## Depth 정책

`depth_hint`는 렌더링용 pseudo depth입니다. calibrated 3D 또는 estimated 3D로 취급하면 안 됩니다.

렌더링에서 depth source 우선순위는 아래와 같습니다.

```text
estimated_3d > calibrated_3d > depth_hint > flat image_2d
```
