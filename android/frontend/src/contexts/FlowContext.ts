import { createContext } from 'react';

import type {
  RNFileInput,
  SignerFrame,
  SignToSpeechResult,
  SpeechToSignResult,
} from '@/lib/api/types';

import type { FlowDispatch, FlowState } from './flowMachine';

export type FlowContextValue = {
  state: FlowState;
  dispatch: FlowDispatch;
  lastSpeechToSign: SpeechToSignResult | null;
  lastSignToSpeech: SignToSpeechResult | null;
  setLastSpeechToSign: (r: SpeechToSignResult) => void;
  setLastSignToSpeech: (r: SignToSpeechResult) => void;
  // 청인이 녹음한 음성 파일을 HearingInput → HearingLoading으로 넘기는 store.
  // Loading mount 시 useEffect로 읽어 speechToSign multipart 호출 후 clear.
  pendingAudioFile: RNFileInput | null;
  setPendingAudioFile: (f: RNFileInput | null) => void;
  // 농인이 녹화한 수어 좌표 frames를 SignerInput → SignerLoading으로 넘기는 store.
  // Loading mount 시 useEffect로 읽어 signToSpeech 호출 후 clear.
  pendingSignFrames: SignerFrame[] | null;
  setPendingSignFrames: (f: SignerFrame[] | null) => void;
  // 네트워크/통신/서버 에러 시 NetworkErrorToast로 표시할 메시지.
  // catch 종류별로 호출자가 메시지 결정.
  networkErrorMessage: string | null;
  setNetworkErrorMessage: (m: string | null) => void;
  // 응답 정상이지만 인식 결과 비음일 때 ErrorModal 표시.
  // tone에 따라 카피·재시도 대상 화면 분기 (FlowContainer의 RecognitionErrorBoundary).
  recognitionErrorTone: 'hearing' | 'signer' | null;
  setRecognitionErrorTone: (t: 'hearing' | 'signer' | null) => void;
};

export const FlowContext = createContext<FlowContextValue | null>(null);
