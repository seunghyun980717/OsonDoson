// Spring REST translation 호출 — android/frontend/src/lib/api/translation.ts 미러.
// 차이점: speechToSign이 RNFileInput 대신 Blob을 직접 받음 (web MediaRecorder 출력).

import { ENDPOINTS } from '@/constants/api';

import { buildUrl, requestJson } from './client';
import type {
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

// 음성(Blob) → 수어 — multipart 업로드
// Web MediaRecorder Blob을 그대로 받음. 파일명/확장자는 mime에서 추론.
// (Content-Type 직접 지정 X — FormData가 boundary 포함해 알아서 처리)
export function speechToSign(audio: Blob, filename?: string) {
  const formData = new FormData();
  const name = filename ?? inferFilename(audio);
  formData.append('file', audio, name);

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

// === helpers ===

// MediaRecorder Blob의 mime → 확장자 매핑. Spring multipart는 확장자/Content-Type을 그대로 받아
// 다운스트림 FastAPI STT에 전달함. 가장 흔한 케이스(webm, mp4, wav) 위주로 처리.
function inferFilename(blob: Blob): string {
  const t = (blob.type || '').toLowerCase();
  if (t.startsWith('audio/webm')) return 'recording.webm';
  if (t.startsWith('audio/mp4') || t.startsWith('audio/m4a')) return 'recording.m4a';
  if (t.startsWith('audio/wav') || t.startsWith('audio/x-wav')) return 'recording.wav';
  if (t.startsWith('audio/ogg')) return 'recording.ogg';
  if (t.startsWith('audio/mpeg')) return 'recording.mp3';
  return 'recording.bin';
}
