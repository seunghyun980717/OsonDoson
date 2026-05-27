import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useState } from 'react';

import type { RNFileInput } from '@/lib/api/types';

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

const STATUS_POLL_MS = 100;

export type MicPermission = 'idle' | 'granted' | 'denied';

// expo-audio HIGH_QUALITY는 AAC 인코딩 + m4a/mp4 컨테이너.
// uri 확장자에서 type 추론 — 알 수 없으면 m4a로 fallback.
const inferAudioFile = (uri: string): RNFileInput => {
  const name = uri.split('/').pop() ?? 'recording.m4a';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'm4a';
  // mp4 컨테이너에 든 오디오는 보통 m4a로 표기
  const subtype = ext === 'mp4' ? 'm4a' : ext;
  return { uri, name, type: `audio/${subtype}` };
};

export const useMicRecording = () => {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, STATUS_POLL_MS);
  const [permission, setPermission] = useState<MicPermission>('idle');

  const start = useCallback(async (): Promise<boolean> => {
    const status = await requestRecordingPermissionsAsync();
    if (!status.granted) {
      setPermission('denied');
      return false;
    }
    setPermission('granted');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  }, [recorder]);

  const stop = useCallback(async (): Promise<RNFileInput | null> => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return null;
    return inferAudioFile(uri);
  }, [recorder]);

  return {
    permission,
    isRecording: state.isRecording,
    durationMillis: state.durationMillis,
    metering: state.metering,
    start,
    stop,
  };
};
