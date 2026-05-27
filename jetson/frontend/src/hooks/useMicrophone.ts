import { useCallback, useEffect, useRef, useState } from 'react';

import type { AudioFormat } from '@/types/ws';

export type MicrophoneStatus = 'idle' | 'requesting' | 'ready' | 'recording' | 'denied' | 'error';

export type RecordingResult = {
  blob: Blob;
  format: AudioFormat;
  durationSec: number;
};

type UseMicrophoneResult = {
  status: MicrophoneStatus;
  errorMessage: string | null;
  durationSec: number;
  stream: MediaStream | null;
  requestPermission: () => Promise<MediaStream | null>;
  startRecording: (maxDurationSec?: number) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  cancelRecording: () => void;
  clearError: () => void;
  releaseStream: () => void;
};

const SUPPORTED_MIME_TYPES: Array<{ mime: string; format: AudioFormat }> = [
  { mime: 'audio/webm;codecs=opus', format: 'webm' },
  { mime: 'audio/webm', format: 'webm' },
  { mime: 'audio/wav', format: 'wav' },
];

const pickMimeType = (): { mime: string; format: AudioFormat } | null => {
  for (const candidate of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
  }
  return null;
};

export const useMicrophone = (): UseMicrophoneResult => {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<{ mime: string; format: AudioFormat } | null>(null);
  const startTimeRef = useRef(0);
  const tickIntervalRef = useRef<number | null>(null);
  const maxStopTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const clearTimers = () => {
    if (tickIntervalRef.current !== null) {
      window.clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (maxStopTimerRef.current !== null) {
      window.clearTimeout(maxStopTimerRef.current);
      maxStopTimerRef.current = null;
    }
  };

  const releaseStream = useCallback(() => {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setStatus('idle');
    setDurationSec(0);
  }, []);

  const requestPermission = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;

    setStatus('requesting');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStream(stream);
      setStatus('ready');
      return stream;
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setStatus('denied');
        setErrorMessage('마이크 권한이 꺼져 있어요. 브라우저에서 마이크 사용을 허용해 주세요.');
      } else if (error.name === 'NotFoundError') {
        setStatus('error');
        setErrorMessage('사용할 수 있는 마이크가 없어요. 마이크가 연결되어 있는지 확인해 주세요.');
      } else {
        // raw 에러는 디버깅용으로 콘솔에만 — 사용자에게는 친화적 문구만 노출
        console.error('[useMicrophone] getUserMedia 실패:', error);
        setStatus('error');
        setErrorMessage('지금 마이크를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.');
      }
      return null;
    }
  }, []);

  const startRecording = useCallback(
    async (maxDurationSec?: number) => {
      const stream = streamRef.current ?? (await requestPermission());
      if (!stream) return;

      const mimeChoice = pickMimeType();
      if (!mimeChoice) {
        setStatus('error');
        setErrorMessage('사용 중인 브라우저에서는 음성 입력을 사용할 수 없어요.');
        return;
      }

      mimeRef.current = mimeChoice;
      chunksRef.current = [];
      cancelledRef.current = false;
      setDurationSec(0);

      const recorder = new MediaRecorder(stream, { mimeType: mimeChoice.mime });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorderRef.current = recorder;
      startTimeRef.current = performance.now();

      recorder.start();
      setStatus('recording');

      tickIntervalRef.current = window.setInterval(() => {
        const elapsed = (performance.now() - startTimeRef.current) / 1000;
        setDurationSec(Math.floor(elapsed));
      }, 250);

      if (maxDurationSec && maxDurationSec > 0) {
        maxStopTimerRef.current = window.setTimeout(() => {
          if (recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.stop();
          }
        }, maxDurationSec * 1000);
      }
    },
    [requestPermission],
  );

  const stopRecording = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      const mimeChoice = mimeRef.current;

      if (!recorder || recorder.state === 'inactive' || !mimeChoice) {
        resolve(null);
        return;
      }

      const elapsedSec = (performance.now() - startTimeRef.current) / 1000;

      recorder.onstop = () => {
        clearTimers();
        recorderRef.current = null;
        setStatus(streamRef.current ? 'ready' : 'idle');

        if (cancelledRef.current) {
          chunksRef.current = [];
          resolve(null);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeChoice.mime });
        chunksRef.current = [];
        resolve({
          blob,
          format: mimeChoice.format,
          durationSec: elapsedSec,
        });
      };

      if (recorder.state === 'recording') {
        recorder.stop();
      }
    });
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    } else {
      recorderRef.current = null;
      chunksRef.current = [];
      setStatus(streamRef.current ? 'ready' : 'idle');
      setDurationSec(0);
    }
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return {
    status,
    errorMessage,
    durationSec,
    stream,
    requestPermission,
    startRecording,
    stopRecording,
    cancelRecording,
    clearError,
    releaseStream,
  };
};
