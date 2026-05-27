import { VolumeX } from 'lucide-react';
import { useState } from 'react';

import { useHearing } from '@/hooks/useHearing';
import type { HearingDispatch } from '@/hooks/useHearingFlow';
import { useHearingSession } from '@/hooks/useHearingSession';

import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';
import { SpeedPills } from './SpeedPills';
import { VoicePlayer } from './VoicePlayer';

type HearingResultScreenProps = {
  dispatch: HearingDispatch;
};

export const HearingResultScreen = ({ dispatch }: HearingResultScreenProps) => {
  const { ttsEnabled, playbackSpeed } = useHearing();
  const { lastResult } = useHearingSession();
  const [replayNonce, setReplayNonce] = useState(0);

  const korean = lastResult?.korean ?? '(아직 도착한 결과가 없습니다)';
  const glosses = lastResult?.glosses ?? [];
  const audio = lastResult?.audio ?? null;

  const handleReplay = () => {
    setReplayNonce((n) => n + 1);
    dispatch({ type: 'REPLAY' });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-5 overflow-auto px-4 py-4">
        <div className="text-text-muted text-2xl tracking-wide">고객이 보낸 내용</div>

        <div className="bg-surface-screen border-hearing-bg flex flex-col items-center gap-4 rounded-2xl border px-6 py-6 text-center shadow-[0_4px_12px_rgba(0,0,0,0.04)]">
          <div className="text-text-primary text-4xl leading-snug font-bold">{korean}</div>
          {glosses.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {glosses.map((gloss, idx) => (
                <span
                  key={`${gloss}-${idx}`}
                  className="border-border-default text-text-secondary rounded-full border bg-neutral-50 px-3 py-1.5 text-base"
                >
                  {gloss}
                </span>
              ))}
            </div>
          )}
        </div>

        {ttsEnabled ? (
          <div className="flex flex-col gap-3">
            <VoicePlayer audio={audio} playbackSpeed={playbackSpeed} replayNonce={replayNonce} />
            <div className="flex justify-end">
              <SpeedPills />
            </div>
          </div>
        ) : (
          <div className="border-border-default text-text-secondary flex items-center gap-3 rounded-2xl border bg-neutral-50 px-6 py-5 text-2xl">
            <VolumeX size={28} strokeWidth={2} aria-hidden="true" />
            음성 재생이 꺼져 있어요
          </div>
        )}
      </div>

      <ActionBar layout="split">
        <ActionButton
          variant="neutral"
          className="w-full"
          onClick={handleReplay}
        >
          반복 재생
        </ActionButton>
        <ActionButton
          variant="hearing"
          className="w-full"
          onClick={() => dispatch({ type: 'ANSWER' })}
        >
          답변하기 →
        </ActionButton>
      </ActionBar>
    </div>
  );
};
