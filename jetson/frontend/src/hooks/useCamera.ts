import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

type UseCameraResult = {
  status: CameraStatus;
  errorMessage: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  requestStream: () => Promise<MediaStream | null>;
  releaseStream: () => void;
};

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export const useCamera = (): UseCameraResult => {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('idle');
  }, []);

  const requestStream = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) {
      if (videoRef.current && !videoRef.current.srcObject) {
        videoRef.current.srcObject = streamRef.current;
      }
      return streamRef.current;
    }

    setStatus('requesting');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: VIDEO_CONSTRAINTS,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus('ready');
      return stream;
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setStatus('denied');
        setErrorMessage('카메라 권한이 꺼져 있어요. 브라우저에서 카메라 사용을 허용해 주세요.');
      } else if (error.name === 'NotFoundError') {
        setStatus('error');
        setErrorMessage('사용할 수 있는 카메라가 없어요. 카메라가 연결되어 있는지 확인해 주세요.');
      } else {
        // raw 에러는 디버깅용으로 콘솔에만 — 사용자에게는 친화적 문구만 노출
        console.error('[useCamera] getUserMedia 실패:', error);
        setStatus('error');
        setErrorMessage('지금 카메라를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return { status, errorMessage, videoRef, requestStream, releaseStream };
};
