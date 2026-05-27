// Spring API 호출 공통 wrapper.
// 가이드의 requestJson 패턴을 RN 환경에 맞춰 미러링.

import type { ApiResponse } from './types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

// fetch 기본 timeout 없음 — 응답 없으면 무한 대기. 음성 업로드 + 모델 처리 시간 고려해 30초.
const DEFAULT_TIMEOUT_MS = 30_000;

if (!BASE_URL && __DEV__) {
  console.warn('[api] EXPO_PUBLIC_API_URL is empty. Set it in .env.local.');
}

export function buildUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

type RequestOptions = RequestInit & { timeoutMs?: number };

// Spring 응답이 { code, message, data } 형태이고 SUCCESS일 때만 data를 풀어 반환.
// 그 외는 throw — 호출 측에서 try/catch.
export async function requestJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const url = buildUrl(path);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const json = (await response.json()) as ApiResponse<T>;

    if (!response.ok || json.code !== 'SUCCESS' || json.data == null) {
      throw new Error(json.message || `API request failed: ${response.status}`);
    }

    return json.data;
  } finally {
    clearTimeout(timer);
  }
}
