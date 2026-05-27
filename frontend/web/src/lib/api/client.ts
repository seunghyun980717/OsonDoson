// Spring API 호출 공통 wrapper.
// android/frontend/src/lib/api/client.ts 미러. RN 환경 대신 브라우저 fetch + Vite env.

import type { ApiResponse } from './types';

// Spring 응답의 code/status를 보존해서 호출 측에서 분기할 수 있게 해주는 에러.
// 예: FastAPI 다운 시 code='FASTAPI_UNAVAILABLE' 같이 문자열 code로 식별.
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// 빈 문자열이면 상대경로(/api/...) 호출 -> vite dev proxy 또는 same-origin으로
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

// 음성 업로드 + 모델 처리 시간 고려해 기본 30초.
const DEFAULT_TIMEOUT_MS = 30_000;

if (!BASE_URL && import.meta.env.DEV) {
  // dev에서는 vite proxy로 흡수되므로 정보성 로그만
  console.info('[api] VITE_API_BASE_URL empty — using relative paths via dev proxy.');
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
      throw new ApiError(
        json.code ?? 'UNKNOWN',
        response.status,
        json.message || `API request failed: ${response.status}`,
      );
    }

    return json.data;
  } finally {
    clearTimeout(timer);
  }
}
