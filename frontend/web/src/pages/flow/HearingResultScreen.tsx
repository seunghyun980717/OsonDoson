// 청인 결과 — lastSignToSpeech의 korean 평문 + 자동 음성 재생.
import { Fragment, useState } from 'react';

import { ActionBar } from '@/components/action/ActionBar';
import { ActionButton } from '@/components/action/ActionButton';
import { type PlaybackSpeed, SpeedPills } from '@/components/hearing/SpeedPills';
import { StateBadge } from '@/components/hearing/StateBadge';
import { VoicePlayer } from '@/components/hearing/VoicePlayer';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { useFlow } from '@/hooks/useFlow';

export const HearingResultScreen = () => {
  const { state, dispatch, lastSignToSpeech } = useFlow();
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [replayNonce, setReplayNonce] = useState(0);

  // audio_url(상대경로) → VoicePlayer가 audio.url로 받음. 백엔드가 audio 객체를 보낼 때만 재생 활성.
  const audio = lastSignToSpeech?.audio ?? null;
  const audioFromUrl = !audio && lastSignToSpeech?.audio_url
    ? {
        format: 'mp3',
        content_type: 'audio/mpeg',
        url: lastSignToSpeech.audio_url,
      }
    : null;
  const playableAudio = audio ?? audioFromUrl;

  const korean = lastSignToSpeech?.korean ?? '';
  const glosses = lastSignToSpeech?.glosses ?? [];

  const handleReplay = () => setReplayNonce((n) => n + 1);

  return (
    <PageLayout header={<StatusBar left={<StateBadge state={state} />} tone="hearing" />}>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col gap-6 overflow-auto px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="text-hearing-action-hover text-2xl font-medium tracking-wider uppercase">
              상대 보낸 내용
            </div>
            <SpeedPills value={playbackSpeed} onChange={setPlaybackSpeed} />
          </div>

          <div className="bg-hearing-bg rounded-xl px-6 py-5">
            <p className="text-text-primary text-4xl leading-snug font-semibold whitespace-pre-line">
              {korean || '(결과 없음)'}
            </p>
          </div>

          <VoicePlayer
            audio={playableAudio}
            playbackSpeed={playbackSpeed}
            autoPlay
            replayNonce={replayNonce}
          />

          {glosses.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {glosses.map((gloss, i) => (
                <Fragment key={`${gloss}-${i}`}>
                  <span className="border-border-default text-text-secondary rounded-pill border bg-neutral-100 px-4 py-2 text-xl">
                    {gloss}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
        </div>

        <ActionBar layout="split">
          <ActionButton variant="neutral" className="w-full" onClick={handleReplay}>
            다시 듣기
          </ActionButton>
          <ActionButton
            variant="hearing"
            className="w-full"
            onClick={() => dispatch({ type: 'NEXT_TURN' })}
          >
            답변하기
          </ActionButton>
        </ActionBar>
      </div>
    </PageLayout>
  );
};
