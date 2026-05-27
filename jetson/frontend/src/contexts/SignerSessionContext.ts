import { createContext } from 'react';

import type { SignerDispatch, SignerState } from '@/hooks/useSignerFlow';
import type { ReadyState } from '@/hooks/useWebSocket';
import type { SignerFrame, SpeechToSignResult } from '@/types/ws';

export type SignerSessionValue = {
  state: SignerState;
  dispatch: SignerDispatch;
  readyState: ReadyState;
  peerConnected: boolean;
  lastResult: SpeechToSignResult | null;
  errorMessage: string | null;
  recognitionError: string | null;
  clearError: () => void;
  clearRecognitionError: () => void;
  sendKeypoints: (frames: SignerFrame[]) => void;
};

export const SignerSessionContext = createContext<SignerSessionValue | null>(null);
