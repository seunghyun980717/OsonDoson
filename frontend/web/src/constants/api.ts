// Spring API endpoints — android/frontend/src/constants/api.ts 미러
// FastAPI 직접 호출 금지 — Spring base URL만 사용.
export const ENDPOINTS = {
  signToSpeech: '/api/translation/sign-to-speech',
  speechToSign: '/api/translation/speech-to-sign',
  textToSign: '/api/translation/text-to-sign',
  glossesToSpeech: '/api/translation/glosses-to-speech',
  glossRecommend: '/api/glosses/recommend',
  audioAsset: (fileName: string) => `/api/assets/audio/${fileName}`,
  // 한손 수어 데이터 수집 (현재 웹 MVP 범위 외 — 타입만 유지)
  oneHandSigns: '/api/one-hand-signs',
} as const;
