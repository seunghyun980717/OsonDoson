# 3D 작업 공간

이 디렉터리는 역할별로 분리해서 관리합니다.

```text
viewer/              Three.js/Vite 기반 3D 뷰어와 렌더링 테스트 앱
keypoint-converter/  원본 keypoint 데이터를 단어 JSON으로 변환하는 도구
data/                최종 단어 JSON, 변환 리포트, 로컬 캐시 저장 위치
docs/                스키마, 변환 규칙, depth 정책 등 공통 문서
```

## 정리 방향

- `viewer`는 렌더링과 재생 테스트만 담당합니다.
- `keypoint-converter`는 AIHub/말뭉치 파싱, 구간 crop, 2D pixel 좌표 보존, `depth_hint` 생성을 담당합니다.
- 최종 단어 JSON은 `data/words`에 저장합니다.
- 변환 리포트는 `data/reports`, 임시 캐시는 `data/cache`에 저장합니다.
- 나중에 `estimated_3d` 작업이 추가되더라도 단어 JSON의 외부 구조는 유지하는 방향으로 구현합니다.

## 실행 방법

뷰어는 `viewer` 디렉터리에서 실행합니다.

```sh
cd viewer
npm install
npm run dev
```

컨버터 스크립트는 `keypoint-converter` 디렉터리에서 실행합니다.

```sh
cd keypoint-converter
npm run build:word-json -- --type corpus --corpus-dir "..."
```

## 생성 위치

최종 단어 JSON은 아래 위치에 저장합니다.

```text
data/words/{word}.json
```

변환 리포트는 아래 위치에 저장합니다.

```text
data/reports/
```
