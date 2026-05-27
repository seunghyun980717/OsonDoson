import { ReactNode, useMemo, useReducer, useState } from 'react';

import type {
  RNFileInput,
  SignerFrame,
  SignToSpeechResult,
  SpeechToSignResult,
} from '@/lib/api/types';

import { FlowContext, FlowContextValue } from './FlowContext';
import { FlowEntry, flowReducer, initialStateFor } from './flowMachine';

type Props = {
  entry: FlowEntry;
  children: ReactNode;
};

export const FlowProvider = ({ entry, children }: Props) => {
  const [state, dispatch] = useReducer(flowReducer, entry, initialStateFor);
  const [lastSpeechToSign, setLastSpeechToSign] = useState<SpeechToSignResult | null>(null);
  const [lastSignToSpeech, setLastSignToSpeech] = useState<SignToSpeechResult | null>(null);
  const [pendingAudioFile, setPendingAudioFile] = useState<RNFileInput | null>(null);
  const [pendingSignFrames, setPendingSignFrames] = useState<SignerFrame[] | null>(null);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<string | null>(null);
  const [recognitionErrorTone, setRecognitionErrorTone] = useState<'hearing' | 'signer' | null>(
    null,
  );

  const value = useMemo<FlowContextValue>(
    () => ({
      state,
      dispatch,
      lastSpeechToSign,
      lastSignToSpeech,
      setLastSpeechToSign,
      setLastSignToSpeech,
      pendingAudioFile,
      setPendingAudioFile,
      pendingSignFrames,
      setPendingSignFrames,
      networkErrorMessage,
      setNetworkErrorMessage,
      recognitionErrorTone,
      setRecognitionErrorTone,
    }),
    [
      state,
      lastSpeechToSign,
      lastSignToSpeech,
      pendingAudioFile,
      pendingSignFrames,
      networkErrorMessage,
      recognitionErrorTone,
    ],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};
