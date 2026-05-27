import { useEffect, useRef, useState } from 'react';

import { useCamera } from '../../hooks/useCamera';
import { useMediaPipeKeypoints } from '../../hooks/useMediaPipeKeypoints';
import { useSignerDetectionState } from '../../hooks/useSignerDetectionState';
import type { SignerDispatch } from '../../hooks/useSignerFlow';
import { useSignerSession } from '../../hooks/useSignerSession';
import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';
import { ErrorInline } from '../feedback/ErrorInline';
import { SignerGuideFrame } from './SignerGuideFrame';
import { SignerLiveStatus } from './SignerLiveStatus';

// 농인 가독성을 위해 UI 카피는 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
//   - 짧음 에러: '수어가 너무 짧아요. 조금 더 길게 다시 해주세요.' → '수어 너무 짧음 / 길게 다시'
//   - 전송 중: '전송 중...' → '전송 중'

type Props = { dispatch: SignerDispatch };

const SIGNER_MAX_DURATION_SEC = 30;
// 너무 짧은 사인은 BE로 보내봐야 'pipeline failed'로 거부됨 — 송신 전 차단해 사용자한테 즉시 안내.
// 30fps 기준 약 0.16초. 진짜 실수성 클릭만 막고, 짧은 사인은 BE까지 보냄.
const MIN_FRAMES_TO_SEND = 5;
const TOO_SHORT_AUTOCLEAR_MS = 3000;

const formatTime = (total: number) => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const SignerRecordingScreen = ({ dispatch }: Props) => {
  const { sendKeypoints } = useSignerSession();
  const { status, errorMessage: cameraError, videoRef, requestStream } = useCamera();
  const mp = useMediaPipeKeypoints(videoRef);
  const detection = useSignerDetectionState(
    mp.isDetecting && status === 'ready',
    mp.latestFrameRef,
  );
  const [recSeconds, setRecSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tooShortError, setTooShortError] = useState<string | null>(null);

  // 너무 짧음 안내는 일회성 — 일정 시간 후 자동으로 닫힘
  useEffect(() => {
    if (!tooShortError) return;
    const id = window.setTimeout(() => setTooShortError(null), TOO_SHORT_AUTOCLEAR_MS);
    return () => window.clearTimeout(id);
  }, [tooShortError]);

  // 1. 마운트 시 카메라 권한 + 스트림 획득
  useEffect(() => {
    void requestStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. 카메라 + MediaPipe 둘 다 준비되면 검출 루프 시작 / 언마운트 시 정리
  useEffect(() => {
    if (status === 'ready' && mp.isReady && !mp.isDetecting) {
      mp.startDetection();
    }
    return () => {
      mp.cancelExtraction();
      mp.stopDetection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mp.isReady]);

  // 3. 검출이 STABLE_MS(800ms) 이상 'good' 상태로 안정되면 자동 REC 시작
  //    — 30초 타이머가 사용자가 자세 잡힌 순간부터 카운트되어 데이터 효율적으로 사용
  useEffect(() => {
    if (detection.isStable && !mp.isExtracting && !isSubmitting) {
      mp.startExtraction(SIGNER_MAX_DURATION_SEC);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.isStable]);

  // 4. REC 타이머 — isExtracting일 때만 카운트
  useEffect(() => {
    if (!mp.isExtracting) {
      // 추출 종료/대기 시 카운터 리셋 — 외부 상태(isExtracting) 변화 동기화이므로 의도된 set
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecSeconds(0);
      return;
    }
    const id = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [mp.isExtracting]);

  const handleStop = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const frames = mp.stopExtraction();
    if (frames.length < MIN_FRAMES_TO_SEND) {
      // 수어가 너무 짧음/빈약 — BE 송신 차단. 사용자한테 안내하고 REC 즉시 새로 시작해 재시도 가능
      setIsSubmitting(false);
      setRecSeconds(0);
      setTooShortError('수어 너무 짧음 / 길게 다시');
      mp.startExtraction(SIGNER_MAX_DURATION_SEC);
      return;
    }
    // 디버깅용 — BE 응답이 'pipeline failed'로 올 때 실제 송신된 프레임 수 추적 위함
    console.info('[Signer] keypoints sent:', frames.length, 'frames');
    sendKeypoints(frames);
    // sendKeypoints 내부에서 STOP_RECORDING dispatch까지 일어남
  };

  // 5. 30초 타이머 만료 시 자동 송신 — isExtracting이 true→false로 전이될 때
  //    사용자 클릭이 아닌 경우(=isSubmitting === false) handleStop 호출
  const prevExtractingRef = useRef(false);
  useEffect(() => {
    if (prevExtractingRef.current && !mp.isExtracting && !isSubmitting) {
      handleStop();
    }
    prevExtractingRef.current = mp.isExtracting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.isExtracting]);

  const handleCancel = () => {
    mp.cancelExtraction();
    dispatch({ type: 'CANCEL' });
  };

  const error = cameraError ?? mp.errorMessage;

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="px-4 pt-2">
          <ErrorInline tone="signer">{error}</ErrorInline>
        </div>
      )}
      {!error && tooShortError && (
        <div className="px-4 pt-2">
          <ErrorInline tone="signer" onDismiss={() => setTooShortError(null)}>
            {tooShortError}
          </ErrorInline>
        </div>
      )}

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1a1a18]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
        />

        <SignerGuideFrame />

        {/* 검출 안정 + REC 시작 전까지 카메라 영역을 살짝 어둡게 — REC 시작 모먼트와 함께 사라져 전환을 명확히 신호 */}
        <div
          className={`pointer-events-none absolute inset-0 bg-black/40 transition-opacity duration-200 ease-out ${
            mp.isExtracting || isSubmitting ? 'opacity-0' : 'opacity-100'
          }`}
        />

        <SignerLiveStatus kind={detection.kind} />

        {/* REC 인디케이터 — dim 제거와 동시에 fade-in 되어 시각적 전환 강조 */}
        <div
          className={`absolute top-3 right-3 z-10 flex items-center gap-2.5 rounded-md bg-black/70 px-4 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-opacity duration-200 ease-out ${
            mp.isExtracting ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span className="rounded-pill size-3 animate-pulse bg-red-500" />
          <span className="text-base font-semibold text-[#f1efe8] tabular-nums">
            REC · {formatTime(recSeconds)}
          </span>
        </div>
      </div>

      <ActionBar layout="split">
        <ActionButton
          variant="neutral"
          className="w-full"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          취소
        </ActionButton>
        <ActionButton
          variant="signer"
          className="w-full"
          onClick={handleStop}
          disabled={!mp.isExtracting || isSubmitting}
        >
          {isSubmitting ? '전송 중' : '수어 완료 →'}
        </ActionButton>
      </ActionBar>
    </div>
  );
};
