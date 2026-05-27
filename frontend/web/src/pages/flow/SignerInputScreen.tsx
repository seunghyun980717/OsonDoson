// 농인 입력 — idle/recording 두 모드를 reducer state로 분기.
// jetson의 SignerIdleScreen + SignerRecordingScreen 원본 레이아웃을 그대로 유지.
// idle: 카메라 없는 풀스크린 헤로 + 버튼 (카메라 권한은 백그라운드 요청)
// recording: 카메라 풀스크린 + 가이드 + dim overlay + REC 인디케이터 + 액션바
import { Hand } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ActionBar } from '@/components/action/ActionBar';
import { ActionButton } from '@/components/action/ActionButton';
import { ErrorInline } from '@/components/feedback/ErrorInline';
import { PermissionFallbackModal } from '@/components/feedback/PermissionFallbackModal';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { SignerGuideFrame } from '@/components/signer/SignerGuideFrame';
import { SignerLiveStatus } from '@/components/signer/SignerLiveStatus';
import { SignerStateBadge } from '@/components/signer/SignerStateBadge';
import { useCamera } from '@/hooks/useCamera';
import { useFlow } from '@/hooks/useFlow';
import { preloadMediaPipeKeypoints, useMediaPipeKeypoints } from '@/hooks/useMediaPipeKeypoints';
import { useSignerDetectionState } from '@/hooks/useSignerDetectionState';

const MAX_RECORD_SEC = 30;
// 너무 짧은 사인은 BE pipeline failed 로 떨어지므로 사전 차단 (jetson 동일).
const MIN_FRAMES_TO_SEND = 5;
const TOO_SHORT_AUTOCLEAR_MS = 3000;

const formatTime = (total: number): string => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const SignerInputScreen = () => {
  const navigate = useNavigate();
  const { state, dispatch, setPendingSignFrames } = useFlow();
  const isRecording = state === 'signer_recording';

  // video element 의 ref 를 우리가 소유하고 useCamera/useMediaPipeKeypoints 양쪽에 주입.
  // (useCamera 가 RefObject 를 리턴하면 ref-tainted 객체가 되어 lint react-hooks/refs 룰이
  // 모든 property 접근을 막아버리는 문제를 우회 — useCamera 시그니처 자체를 인자형으로 바꿈)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camera = useCamera(videoRef);
  const mp = useMediaPipeKeypoints(videoRef);
  const detection = useSignerDetectionState(
    mp.isDetecting && camera.status === 'ready',
    mp.latestFrameRef,
  );

  const [permissionFallback, setPermissionFallback] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tooShortError, setTooShortError] = useState<string | null>(null);

  // 화면 진입 시 MediaPipe 모델 미리 로드 + 카메라 권한 백그라운드 요청
  useEffect(() => {
    preloadMediaPipeKeypoints();
    void camera.requestStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 권한 거부/실패 시 fallback 모달
  useEffect(() => {
    // camera.status 변경에 따라 fallback 모달 노출 — 외부 hook state 변화를 trigger 로 받는 의도된 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (camera.status === 'denied' || camera.status === 'error') setPermissionFallback(true);
  }, [camera.status]);

  // recording 진입 시 <video> 가 새로 마운트됨 — useCamera 가 들고있는 stream 을
  // 새 video.srcObject 에 다시 바인딩하려면 requestStream() 한 번 더 호출.
  // (idle 에서는 video 가 DOM 에 없어 첫 호출 때 srcObject 가 안 붙었음)
  useEffect(() => {
    if (!isRecording) return;
    void camera.requestStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // recording 진입 시 detection 시작, 빠져나갈 때 정리
  useEffect(() => {
    if (!isRecording) return;
    if (mp.isReady && camera.status === 'ready' && !mp.isDetecting) {
      mp.startDetection();
    }
    return () => {
      mp.cancelExtraction();
      mp.stopDetection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, mp.isReady, camera.status]);

  // 검출이 STABLE 되면 자동 extraction 시작 — jetson 동일.
  // 사용자 자세가 잡힌 순간부터 30초 카운트되어 데이터가 의미 있게 채워짐.
  useEffect(() => {
    if (!isRecording) return;
    if (detection.isStable && !mp.isExtracting && !isSubmitting) {
      mp.startExtraction(MAX_RECORD_SEC);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.isStable, isRecording]);

  // REC 타이머 — extraction 중일 때만. mp.isExtracting 변화 동기화이므로 의도된 set.
  useEffect(() => {
    if (!mp.isExtracting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecSeconds(0);
      return;
    }
    const id = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [mp.isExtracting]);

  // "너무 짧음" 안내 자동 close
  useEffect(() => {
    if (!tooShortError) return;
    const t = window.setTimeout(() => setTooShortError(null), TOO_SHORT_AUTOCLEAR_MS);
    return () => window.clearTimeout(t);
  }, [tooShortError]);

  const submitFrames = () => {
    const frames = mp.stopExtraction();
    if (frames.length < MIN_FRAMES_TO_SEND) {
      setIsSubmitting(false);
      setTooShortError('수어 너무 짧음 / 길게 다시');
      // 즉시 재시작 — 사용자가 다시 stable 되면 자동 startExtraction
      return;
    }
    setPendingSignFrames(frames);
    dispatch({ type: 'STOP_INPUT' });
  };

  const handleStop = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    submitFrames();
  };

  // 30초 자동 만료 — mp 내부 타이머가 isExtracting=false 만 켜놓고 frames 는 framesRef 에
  // 그대로 보존. submitFrames() 안의 stopExtraction() 이 누적된 frames 를 반환해주므로
  // isExtracting 의 true→false 전이를 감지해 자동 송신.
  const prevExtractingRef = useRef(false);
  useEffect(() => {
    if (prevExtractingRef.current && !mp.isExtracting && isRecording && !isSubmitting) {
      setIsSubmitting(true);
      submitFrames();
    }
    prevExtractingRef.current = mp.isExtracting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.isExtracting, isRecording, isSubmitting]);

  const handleStart = () => {
    if (camera.status !== 'ready') {
      setPermissionFallback(true);
      return;
    }
    dispatch({ type: 'START_INPUT' });
  };

  const handleCancel = () => {
    mp.cancelExtraction();
    setIsSubmitting(false);
    dispatch({ type: 'CANCEL' });
  };

  const handleClose = () => {
    navigate('/', { replace: true });
  };

  const error = camera.errorMessage ?? mp.errorMessage;

  return (
    <div className="relative h-full w-full">
      <PageLayout
        header={
          <StatusBar
            left={<SignerStateBadge state={state} />}
            right={
              <button
                type="button"
                onClick={handleClose}
                className="text-text-secondary rounded-pill bg-neutral-100 px-4 py-2 text-base"
              >
                처음으로
              </button>
            }
            tone="signer"
          />
        }
      >
        {!isRecording ? (
          // ===== Idle =====
          <div className="relative flex h-full flex-col items-center justify-center gap-8 px-8 pt-10 pb-8">
            {error && (
              <div className="absolute top-4 right-4 left-4">
                <ErrorInline tone="signer">{error}</ErrorInline>
              </div>
            )}

            <div className="flex flex-col items-center gap-6 text-center">
              <div className="bg-signer-bg flex size-[88px] items-center justify-center rounded-full shadow-[0_8px_24px_rgba(245,174,188,0.35)]">
                <Hand
                  size={40}
                  strokeWidth={1.8}
                  className="text-signer-action-hover"
                  aria-hidden="true"
                />
              </div>

              <div className="flex flex-col gap-3">
                <h1 className="text-text-primary text-5xl leading-tight font-bold tracking-[-0.02em] whitespace-pre-line">
                  {'수어\n대화 시작'}
                </h1>
                <p className="text-text-secondary text-2xl leading-relaxed font-medium">
                  버튼 누름
                  <span className="text-signer-action-hover mx-2">/</span>
                  천천히 수어
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={camera.status !== 'ready'}
              className="bg-signer-action text-signer-action-fg hover:bg-signer-action-hover min-w-[72%] rounded-2xl px-10 py-5 text-3xl font-semibold shadow-[0_6px_14px_rgba(245,174,188,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(245,174,188,0.5)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_6px_14px_rgba(245,174,188,0.4)]"
            >
              수어 시작
            </button>
          </div>
        ) : (
          // ===== Recording =====
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

              {/* stable 전까지 dim → REC 시작 시 fade-out 으로 전환 강조 */}
              <div
                className={`pointer-events-none absolute inset-0 bg-black/40 transition-opacity duration-200 ease-out ${
                  mp.isExtracting || isSubmitting ? 'opacity-0' : 'opacity-100'
                }`}
              />

              <SignerLiveStatus kind={detection.kind} />

              <div
                className={`absolute top-3 right-3 z-10 flex items-center gap-2.5 rounded-md bg-black/70 px-4 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-opacity duration-200 ease-out ${
                  mp.isExtracting ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <span className="rounded-pill size-3 animate-pulse bg-red-500" />
                <span className="text-base font-semibold tabular-nums text-[#f1efe8]">
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
        )}
      </PageLayout>

      <PermissionFallbackModal
        visible={permissionFallback}
        tone="signer"
        title={'카메라를 사용할 수 없어요'}
        description={
          error ?? '브라우저 주소창의 잠금 아이콘에서\n카메라 권한을 허용한 뒤 다시 시도해주세요.'
        }
        onRetry={() => {
          setPermissionFallback(false);
          void camera.requestStream();
          // recording 도중 권한 깨졌으면 idle 로 복귀 — autoStart 잔재 정리
          if (isRecording) dispatch({ type: 'JUMP_TO', target: 'signer_idle' });
        }}
        onCancel={() => {
          setPermissionFallback(false);
          handleClose();
        }}
      />
    </div>
  );
};
