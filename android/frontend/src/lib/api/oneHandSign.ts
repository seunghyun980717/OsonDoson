// 한손 수어 데이터 수집 — POST /api/one-hand-signs
// body: { gloss, frames: SignerFrame[] } (좌표만, 영상은 프론트에서만 보관)

import { ENDPOINTS } from '@/constants/api';

import { requestJson } from './client';
import type { OneHandSignCreateRequest, OneHandSignCreateResponse } from './types';

export function createOneHandSign(body: OneHandSignCreateRequest) {
  return requestJson<OneHandSignCreateResponse>(ENDPOINTS.oneHandSigns, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
