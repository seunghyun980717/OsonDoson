// Spring API endpoints (가이드: .claude/mobile_api_spec.md §3)
// FastAPI 직접 호출 금지 — Spring base URL만 사용
export const ENDPOINTS = {
  signToSpeech: '/api/translation/sign-to-speech',
  speechToSign: '/api/translation/speech-to-sign',
  textToSign: '/api/translation/text-to-sign',
  glossesToSpeech: '/api/translation/glosses-to-speech',
  glossRecommend: '/api/glosses/recommend',
  // 추천 상위 카테고리 목록 — BE 가 정상이면 동적 응답, 실패 시 클라이언트 fallback (mock-data.ts)
  glossCategories: '/api/glosses/categories',
  audioAsset: (fileName: string) => `/api/assets/audio/${fileName}`,
  // 한손 수어 데이터 수집 — 사용자가 직접 모집한 좌표 시퀀스 저장 (MongoDB one_hand_signs)
  oneHandSigns: '/api/one-hand-signs',
} as const;
