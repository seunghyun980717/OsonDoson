import { useEffect, useState } from 'react';

import { useAudioLevels } from '@/hooks/useAudioLevels';
import type { HearingDispatch } from '@/hooks/useHearingFlow';
import { useHearingSession } from '@/hooks/useHearingSession';
import { useMicrophone } from '@/hooks/useMicrophone';
import { blobToBase64 } from '@/utils/audio';

import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';
import { ErrorInline } from '../feedback/ErrorInline';
import { Waveform } from './Waveform';

type HearingSpeakingScreenProps = {
  dispatch: HearingDispatch;
};

const MIC_MAX_DURATION_SEC = 60;
const WAVEFORM_BAR_COUNT = 80;

const formatTime = (total: number) => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const HearingSpeakingScreen = ({ dispatch }: HearingSpeakingScreenProps) => {
  const { sendAudio } = useHearingSession();
  const mic = useMicrophone();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const levels = useAudioLevels(
    mic.status === 'recording' ? mic.stream : null,
    WAVEFORM_BAR_COUNT,
  );

  // 화면 진입 시 자동 녹음 시작, 언마운트 시 cancel
  useEffect(() => {
    void mic.startRecording(MIC_MAX_DURATION_SEC);
    return () => {
      mic.cancelRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const result = await mic.stopRecording();
    if (!result) {
      setIsSubmitting(false);
      return;
    }
    const base64 = await blobToBase64(result.blob);
    sendAudio(base64, result.format);
    // sendAudio 내부에서 STOP_RECORDING dispatch까지 일어남
  };

  const handleCancel = () => {
    mic.cancelRecording();
    dispatch({ type: 'CANCEL' });
  };

  return (
    <div className="flex h-full flex-col">
      {mic.errorMessage && (
        <div className="px-4 pt-2">
          <ErrorInline onDismiss={mic.clearError}>{mic.errorMessage}</ErrorInline>
        </div>
      )}

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
  );
};
