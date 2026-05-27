// android/frontend/src/contexts/FlowContext.ts 미러.
// 웹용: pendingAudioFile 타입을 RNFileInput → Blob 으로 변경.
import { createContext } from 'react';

import type { SignerFrame, SignToSpeechResult, SpeechToSignResult } from '@/lib/api/types';

import type { FlowDispatch, FlowState } from './FlowMachine';

export type FlowContextValue = {
  state: FlowState;
  dispatch: FlowDispatch;
  lastSpeechToSign: SpeechToSignResult | null;
  lastSignToSpeech: SignToSpeechResult | null;
  setLastSpeechToSign: (r: SpeechToSignResult | null) => void;
  setLastSignToSpeech: (r: SignToSpeechResult | null) => void;
  // 청인이 녹음한 음성 Blob을 HearingInput → HearingLoading으로 넘기는 store.
  // Loading mount 시 useEffect로 읽어 speechToSign multipart 호출 후 clear.
  pendingAudioFile: Blob | null;
  setPendingAudioFile: (f: Blob | null) => void;
  // 농인이 녹화한 수어 좌표 frames를 SignerInput → SignerLoading으로 넘기는 store.
  pendingSignFrames: SignerFrame[] | null;
  setPendingSignFrames: (f: SignerFrame[] | null) => void;
  // 네트워크/서버 에러 메시지 — NetworkErrorToast.
  networkErrorMessage: string | null;
  setNetworkErrorMessage: (m: string | null) => void;
  // 에러 표시 형태 분기 — generic은 기존 Toast, fastapi_unavailable은 하단 카드 배너.
  // null이면 에러 없음.
  networkErrorVariant: 'generic' | 'fastapi_unavailable' | null;
  setNetworkErrorVariant: (v: 'generic' | 'fastapi_unavailable' | null) => void;
  // 인식 실패(빈 결과 등) — ErrorModal.
  recognitionErrorTone: 'hearing' | 'signer' | null;
  setRecognitionErrorTone: (t: 'hearing' | 'signer' | null) => void;
};

export const FlowContext = createContext<FlowContextValue | null>(null);
