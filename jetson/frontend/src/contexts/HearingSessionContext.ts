import { createContext } from 'react';

import type { HearingDispatch, HearingState } from '@/hooks/useHearingFlow';
import type { ReadyState } from '@/hooks/useWebSocket';
import type { AudioFormat, SignToSpeechResult } from '@/types/ws';

export type HearingSessionValue = {
    state: HearingState;
    dispatch: HearingDispatch;
    readyState: ReadyState;
    peerConnected: boolean;
    lastResult: SignToSpeechResult | null;
    errorMessage: string | null;
    recognitionError: string | null;
    clearError: () => void;
    clearRecognitionError: () => void;
    sendText: (text: string) => void;
    sendAudio: (audioBase64: string, format: AudioFormat) => void;
};

export const HearingSessionContext = createContext<HearingSessionValue | null>(null);
