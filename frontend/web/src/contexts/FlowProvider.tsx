// android/frontend/src/contexts/FlowProvider.tsx 미러.
// 웹용: pendingAudioFile 타입을 Blob 으로 변경.
import { type ReactNode, useMemo, useReducer, useState } from 'react';

import type { SignerFrame, SignToSpeechResult, SpeechToSignResult } from '@/lib/api/types';

import { FlowContext, type FlowContextValue } from './FlowContext';
import { type FlowEntry, flowReducer, initialStateFor } from './FlowMachine';

type Props = {
  entry: FlowEntry;
  children: ReactNode;
};

export const FlowProvider = ({ entry, children }: Props) => {
  const [state, dispatch] = useReducer(flowReducer, entry, initialStateFor);
  const [lastSpeechToSign, setLastSpeechToSign] = useState<SpeechToSignResult | null>(null);
  const [lastSignToSpeech, setLastSignToSpeech] = useState<SignToSpeechResult | null>(null);
  const [pendingAudioFile, setPendingAudioFile] = useState<Blob | null>(null);
  const [pendingSignFrames, setPendingSignFrames] = useState<SignerFrame[] | null>(null);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<string | null>(null);
  const [networkErrorVariant, setNetworkErrorVariant] = useState<
    'generic' | 'fastapi_unavailable' | null
  >(null);
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
      networkErrorVariant,
      setNetworkErrorVariant,
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
      networkErrorVariant,
      recognitionErrorTone,
    ],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};
