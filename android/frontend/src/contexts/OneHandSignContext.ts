import { createContext } from 'react';

import type { SignerFrame } from '@/lib/api/types';

export type OneHandSignStatus = 'idle' | 'recorded' | 'submitting' | 'done' | 'error';

export type OneHandSignContextValue = {
  // MediaPipe 좌표 시퀀스 — 백엔드 전송 대상
  frames: SignerFrame[] | null;
  setFrames: (f: SignerFrame[] | null) => void;
  // mp4 임시 파일 경로 — 프론트 재생 전용, 전송 안 함. Stack 종료 시 FileSystem.deleteAsync.
  videoUri: string | null;
  setVideoUri: (uri: string | null) => void;
  // 사용자 입력 단어
  gloss: string;
  setGloss: (g: string) => void;
  // 제출 상태
  status: OneHandSignStatus;
  setStatus: (s: OneHandSignStatus) => void;
  errorMessage: string | null;
  setErrorMessage: (m: string | null) => void;
  // Stack 종료/완료/취소 시 상태 + mp4 파일 일괄 정리
  reset: () => void;
};

export const OneHandSignContext = createContext<OneHandSignContextValue | null>(null);
