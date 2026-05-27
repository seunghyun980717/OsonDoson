import * as FileSystem from 'expo-file-system';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SignerFrame } from '@/lib/api/types';

import {
  OneHandSignContext,
  OneHandSignContextValue,
  OneHandSignStatus,
} from './OneHandSignContext';

type Props = {
  children: ReactNode;
};

// vision-camera로 받은 mp4는 캐시 디렉터리에 임시 저장된 파일.
// reset / 새 uri 교체 / Stack 언마운트 시점에 비동기 삭제. 실패는 무시(이미 없거나 권한 문제).
const deleteVideoFile = (uri: string | null): void => {
  if (!uri) return;
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch((err) => {
    if (__DEV__) {
      console.warn('[onehand] mp4 삭제 실패:', uri, err);
    }
  });
};

export const OneHandSignProvider = ({ children }: Props) => {
  const [frames, setFrames] = useState<SignerFrame[] | null>(null);
  const [videoUri, setVideoUriState] = useState<string | null>(null);
  const [gloss, setGloss] = useState('');
  const [status, setStatus] = useState<OneHandSignStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previousUriRef = useRef<string | null>(null);

  const setVideoUri = useCallback((uri: string | null) => {
    const prev = previousUriRef.current;
    if (prev && prev !== uri) {
      deleteVideoFile(prev);
    }
    previousUriRef.current = uri;
    setVideoUriState(uri);
  }, []);

  const reset = useCallback(() => {
    deleteVideoFile(previousUriRef.current);
    previousUriRef.current = null;
    setFrames(null);
    setVideoUriState(null);
    setGloss('');
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      deleteVideoFile(previousUriRef.current);
      previousUriRef.current = null;
    };
  }, []);

  const value = useMemo<OneHandSignContextValue>(
    () => ({
      frames,
      setFrames,
      videoUri,
      setVideoUri,
      gloss,
      setGloss,
      status,
      setStatus,
      errorMessage,
      setErrorMessage,
      reset,
    }),
    [frames, videoUri, setVideoUri, gloss, status, errorMessage, reset],
  );

  return <OneHandSignContext.Provider value={value}>{children}</OneHandSignContext.Provider>;
};
