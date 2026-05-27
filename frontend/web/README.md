# frontend/web

웹 배포용 React 프론트엔드.

- 언어/스타일/렌더 라이브러리: `jetson/frontend` 미러링 (Vite + React 19 + TailwindCSS v4 + Three.js + MediaPipe Tasks Vision)
- 통신/상태머신: `android/frontend` 미러링 (Spring REST API, 단일 화면 턴제 reducer)
- 백엔드: 루트의 `backend/` (Spring)

## 로컬 실행

```bash
cd frontend/web
cp .env.example .env.local
# .env.local 의 VITE_DEV_PROXY_TARGET 을 dev Spring 주소 또는 http://localhost:8080 으로 설정

npm install
npm run dev    # http://localhost:5173
```

`/api/*` 요청은 `vite.config.ts` 의 dev proxy 를 통해 Spring 으로 전달됩니다. 운영 빌드에서 절대 URL 을 쓰려면 `VITE_API_BASE_URL` 을 채우세요.

## 로컬 검증 체크리스트

1. `npm install` 후 `npm run build` 한 번 돌려서 TypeScript 컴파일 통과 확인 (런타임 검증 전 정적 통과 보장)
2. `npm run dev` 띄우고 브라우저에서 `http://localhost:5173`
3. 메인 화면에서 **음성으로 시작** → 마이크 권한 허용 → 녹음 → 종료 → 결과 화면에서 아바타가 수어로 재생되는지
4. 결과 화면 **답변하기** → 농인 입력 화면 → 카메라 권한 허용 → 수어 녹화 → 완료 → 결과 화면에서 한국어 + 음성이 나오는지
5. 권한 거부 시 안내 모달 + 텍스트 입력 fallback 동작 확인 (청인 한정)
6. 네트워크 끊김(devtools throttle/offline) 상태에서 NetworkErrorToast 노출 확인

## 미러링 매핑 요약

| 영역 | 원본 | 비고 |
|---|---|---|
| 빌드/번들러 | `jetson/frontend` | Vite 8 + React 19 + TS + Tailwind v4 |
| 라우팅 | `react-router-dom` v7 | Main + Flow 두 라우트만 (turn-based는 reducer 안에서) |
| 상태 머신 | `android/frontend/src/contexts/flowMachine.ts` | 그대로 (`src/contexts/FlowMachine.ts`) |
| REST 클라이언트 | `android/frontend/src/lib/api/*` | `RNFileInput` → `Blob` 으로 변경, `EXPO_PUBLIC_API_URL` → `VITE_API_BASE_URL` |
| 카메라 / 마이크 / MediaPipe | `jetson/frontend/src/hooks/use{Camera,Microphone,MediaPipeKeypoints,...}` | web native API 그대로 |
| Three.js 아바타 | `jetson/frontend/src/lib/avatar-{renderer,viewer}` | 통째로 이식 |
| 디자인 토큰 (Tailwind @theme) | `jetson/frontend/src/styles/global.css` | 그대로 |
| 시각 컴포넌트 | `jetson/frontend/src/components/{action,feedback,layout,hearing,signer}` | atomic 컴포넌트만 (WS 전용 ConnectionStatusBanner / PeerStatusBadge 제외) |
| 화면 6개 (`src/pages/flow/*`) | jetson 비주얼 + android 플로우 결합 신규 작성 |

## 디렉토리 메모

- `public/mediapipe-tasks` — MediaPipe pose/hand 모델 + WASM (jetson에서 복사)
- `public/models/model.glb` — 3D 아바타 모델 (jetson에서 복사)
- `src/lib/avatar-renderer`, `src/lib/avatar-viewer` — Three.js 기반 아바타 IK 렌더러 (jetson)
- `src/lib/api` — Spring REST 호출 래퍼 (android 미러, RNFileInput → Blob 변경)
- `src/contexts/FlowMachine.ts` + `FlowContext.ts` + `FlowProvider.tsx` — 턴제 reducer (android 미러)
- `src/hooks` — 카메라/마이크/MediaPipe (jetson 웹 native API 그대로)
- `src/pages/MainPage.tsx` — 메인(음성 vs 수어 선택)
- `src/pages/FlowPage.tsx` — 단일 화면 턴제 (FlowProvider + FlowSwitch + 에러 boundary들)
- `src/pages/flow/*` — 6개 sub-화면 (Hearing/SignerInput, Loading, Result)

## 알려진 정리 항목

- `src/app/Router.tsx` 는 jetson 컨벤션(`router.tsx` 소문자)과 어긋남. 폴더 단위 ESLint 룰을 해당 폴더만 완화해 충돌 회피. 이후 정식 정리 시 `Router.tsx` → `router.tsx` 로 rename 후 ESLint 룰 복원 추천.
- `src/components/hearing/TtsToggle.tsx` 는 MVP에서 사용처 없음 (결과 화면 자동 재생). 향후 옵션화 대비 stub.

## 브랜치 / 커밋 가이드

```bash
cd <repo root>
# (필요 시) develop 의 기존 uncommitted 변경분은 stash/commit
rm -f .git/index.lock          # 이전 잠금이 남아있을 경우만
git checkout -b feat/client/web-init
git add frontend/web
git commit -m "feat(web): scaffold web frontend (mirror jetson libs + android REST flow)"
git push -u origin feat/client/web-init
```

## 백엔드 호환 메모

- `/api/translation/speech-to-sign` Spring 컨트롤러는 MIME 화이트리스트 없이 multipart `file` 만 받습니다. 웹 MediaRecorder 기본 `audio/webm;codecs=opus` 가 그대로 통과합니다. 하위 FastAPI STT 가 webm 을 못 받는 경우에만 BE 측 추가 조치 필요.
- `/api/translation/sign-to-speech` 는 `signer_keypoints` JSON. `faceLandmarks` 는 optional 로 풀어두었고 Spring `MediaPipeFrameRequest` 는 null 입력 시 빈 리스트로 처리됩니다.
- `audio_url` 은 상대경로(`/api/assets/audio/...`) 로 내려오며 `absoluteAudioUrl()` 헬퍼가 dev proxy / VITE_API_BASE_URL 을 prefix 합니다.
