// 청인 입력 — idle/speaking 두 상태를 모두 처리.
// jetson HearingIdle + HearingSpeaking 비주얼을 합치고, 통신은 우리 FlowProvider의 pendingAudioFile에 Blob 저장.
import { Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ActionBar } from '@/components/action/ActionBar';
import { ActionButton } from '@/components/action/ActionButton';
import { ErrorInline } from '@/components/feedback/ErrorInline';
import { PermissionFallbackModal } from '@/components/feedback/PermissionFallbackModal';
import { StateBadge } from '@/components/hearing/StateBadge';
import { Waveform } from '@/components/hearing/Waveform';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { useAudioLevels } from '@/hooks/useAudioLevels';
import { useFlow } from '@/hooks/useFlow';
import { useMicrophone } from '@/hooks/useMicrophone';

const MIC_MAX_DURATION_SEC = 60;
const WAVEFORM_BAR_COUNT = 80;

const formatTime = (total: number): string => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const HearingInputScreen = () => {
  const navigate = useNavigate();
  const { state, dispatch, setPendingAudioFile } = useFlow();
  const mic = useMicrophone();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [permissionFallback, setPermissionFallback] = useState(false);

  const isSpeaking = state === 'hearing_speaking';
  const levels = useAudioLevels(
    mic.status === 'recording' ? mic.stream : null,
    WAVEFORM_BAR_COUNT,
  );

  // speaking 진입 시 (Idle→Speaking 전이 또는 ErrorModal "다시 시도"의 JUMP_TO) 자동 녹음 시작
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (state !== 'hearing_speaking') {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || mic.status === 'recording') return;
    autoStartedRef.current = true;
    void mic.startRecording(MIC_MAX_DURATION_SEC);
    return () => {
      // speaking에서 빠져나갈 때 (cancel/stop)
      if (mic.status === 'recording') mic.cancelRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleStart = () => {
    // MediaRecorder 가용 여부 사전 확인
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      setPermissionFallback(true);
      return;
    }
    dispatch({ type: 'START_INPUT' });
  };

  const handleStop = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const result = await mic.stopRecording();
    if (!result) {
      setIsSubmitting(false);
      return;
    }
    setPendingAudioFile(result.blob);
    dispatch({ type: 'STOP_INPUT' });
  };

  const handleCancel = () => {
    if (mic.status === 'recording') mic.cancelRecording();
    dispatch({ type: 'CANCEL' });
  };

  const handleClose = () => {
    navigate('/', { replace: true });
  };

  // mic.status === 'denied' → 권한 거부. fallback 모달 띄움.
  useEffect(() => {
    // mic.status 변경에 따라 fallback 모달 노출 — 외부 hook state 변화를 trigger 로 받는 의도된 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mic.status === 'denied' || mic.status === 'error') setPermissionFallback(true);
  }, [mic.status]);

  return (
    <div className="relative h-full w-full">
      <PageLayout
        header={
          <StatusBar
            left={<StateBadge state={state} />}
            right={
              <button
                type="button"
                onClick={handleClose}
                className="text-text-secondary rounded-pill bg-neutral-100 px-4 py-2 text-base"
              >
                처음으로
              </button>
            }
          />
        }
        notification={
          mic.errorMessage ? (
            <ErrorInline onDismiss={mic.clearError}>{mic.errorMessage}</ErrorInline>
          ) : null
        }
      >
        {!isSpeaking ? (
          <div className="flex h-full flex-col items-center justify-center gap-8 px-8 pt-10 pb-8">
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="bg-hearing-bg flex size-[88px] items-center justify-center rounded-full shadow-[0_8px_24px_rgba(181,174,229,0.35)]">
                <Mic
                  size={40}
                  strokeWidth={1.8}
                  className="text-hearing-action-hover"
                  aria-hidden="true"
                />
              </div>
              <div className="flex flex-col gap-3">
                <h1 className="text-text-primary text-5xl leading-tight font-bold tracking-[-0.02em] whitespace-pre-line">
                  {'음성으로\n대화를 시작해보세요'}
                </h1>
                <p className="text-text-secondary text-2xl leading-relaxed font-medium">
                  버튼을 누르고 자연스럽게 말씀해주세요
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStart}
              className="bg-hearing-action text-hearing-action-fg hover:bg-hearing-action-hover min-w-[72%] rounded-2xl px-10 py-5 text-3xl font-semibold shadow-[0_6px_14px_rgba(181,174,229,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(181,174,229,0.5)] active:translate-y-0 active:scale-[0.98]"
            >
              음성 입력 시작
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-3.5">
              <div className="text-text-muted text-base tracking-wider uppercase">음성 인식</div>

              <div className="bg-hearing-bg flex flex-col gap-4 rounded-xl px-6 py-5">
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full bg-red-500" />
                  <span className="text-hearing-action-hover text-2xl font-semibold tabular-nums">
                    녹음 중 · {formatTime(mic.durationSec)}
                  </span>
                </div>
                <Waveform data={levels} />
                <div className="text-hearing-action-hover text-2xl leading-relaxed">
                  {mic.status === 'recording' ? '음성을 입력해주세요...' : '녹음 준비 중...'}
                </div>
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
                variant="hearing"
                className="w-full"
                onClick={handleStop}
                disabled={mic.status !== 'recording' || isSubmitting}
              >
                {isSubmitting ? '전송 중...' : '녹음 종료 →'}
              </ActionButton>
            </ActionBar>
          </div>
        )}
      </PageLayout>

      <PermissionFallbackModal
        visible={permissionFallback}
        tone="hearing"
        title={'마이크를 사용할 수 없어요'}
        description={
          mic.errorMessage ??
          '브라우저 주소창의 잠금 아이콘에서\n마이크 권한을 허용한 뒤 다시 시도해주세요.'
        }
        onRetry={() => {
          setPermissionFallback(false);
          mic.clearError();
          // 권한 다시 요청 + idle 로 명시적 복귀 — autoStartedRef 가 박혀있는 speaking 상태로
          // 그대로 두면 mic 권한이 회복돼도 effect 가 재실행 안 돼서 stuck.
          void mic.requestPermission();
          dispatch({ type: 'JUMP_TO', target: 'hearing_idle' });
        }}
        onCancel={() => {
          setPermissionFallback(false);
          handleClose();
        }}
      />
    </div>
  );
};
