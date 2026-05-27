import { ENDPOINTS } from '@/constants/api';

import { buildUrl, requestJson } from './client';
import type {
  RNFileInput,
  SignToSpeechRequest,
  SignToSpeechResult,
  SpeechToSignResult,
  TextToSignRequest,
} from './types';

// 텍스트 → 수어
export function textToSign(body: TextToSignRequest) {
  return requestJson<SpeechToSignResult>(ENDPOINTS.textToSign, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 음성(파일) → 수어 — multipart 업로드
// 가이드: Content-Type 직접 지정 X (FormData가 boundary 포함해서 알아서 처리)
export function speechToSign(file: RNFileInput) {
  const formData = new FormData();
  formData.append('file', file as unknown as Blob);

  return requestJson<SpeechToSignResult>(ENDPOINTS.speechToSign, {
    method: 'POST',
    body: formData,
  });
}

// 수어 좌표 → 음성
export function signToSpeech(body: SignToSpeechRequest) {
  return requestJson<SignToSpeechResult>(ENDPOINTS.signToSpeech, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 오디오 에셋 절대 URL (응답의 audio_url은 상대 경로)
export function audioAssetUrl(fileName: string): string {
  return buildUrl(ENDPOINTS.audioAsset(fileName));
}

// 응답의 audio_url을 재생 가능한 절대 URL로 변환.
// 상대 경로(`/api/assets/audio/...`)면 BASE_URL prefix, 절대 URL이면 그대로.
export function absoluteAudioUrl(audioUrl: string): string {
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) return audioUrl;
  return buildUrl(audioUrl);
}

// 글로스 추천 — 카테고리 + 현재 시퀀스 → 다음 후보
export type GlossRecommendResponse = {
  recommendations: string[];
};

export function recommendGlosses(category: string, sequence: string[]) {
  return requestJson<GlossRecommendResponse>(ENDPOINTS.glossRecommend, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, sequence }),
  });
}

// 추천 상위 카테고리 목록 — BE `/api/glosses/categories` 호출.
// 실패 시 호출자가 mock-data.ts 의 `recommendCategories` 로 fallback.
export type RecommendCategoriesResponse = {
  categories: string[];
};

export function fetchRecommendCategories() {
  return requestJson<RecommendCategoriesResponse>(ENDPOINTS.glossCategories, {
    method: 'GET',
  });
}

// 글로스 시퀀스 → 음성
export type GlossesToSpeechResponse = {
  type: 'sign_to_speech_result';
  source: 'signer';
  glosses: string[];
  korean: string;
  audio_url?: string | null;
};

export function glossesToSpeech(glosses: string[]) {
  return requestJson<GlossesToSpeechResponse>(ENDPOINTS.glossesToSpeech, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ glosses }),
  });
}
