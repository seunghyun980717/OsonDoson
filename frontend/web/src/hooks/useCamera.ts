// jetson `useCamera` 의 web 어댑테이션.
// 변경: videoRef 를 인자로 받음 (이전엔 hook 이 자체 ref 를 만들어 리턴). 이유는 두 가지:
//   1) useMediaPipeKeypoints 와 동일한 video element 를 공유하기 위해 외부에서 ref 를 주입받는 패턴이 더 자연스러움.
//   2) hook 리턴 객체에 RefObject 를 두면 eslint-plugin-react-hooks v7 의 `react-hooks/refs` 룰이
//      "ref-tainted object" 로 판정해 render 중 모든 property 접근을 막아버림.
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

type UseCameraResult = {
  status: CameraStatus;
  errorMessage: string | null;
  requestStream: () => Promise<MediaStream | null>;
  releaseStream: () => void;
};

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

export const useCamera = (videoRef: RefObject<HTMLVideoElement | null>): UseCameraResult => {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  }, [videoRef]);

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
  }, [videoRef]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return { status, errorMessage, requestStream, releaseStream };
};
