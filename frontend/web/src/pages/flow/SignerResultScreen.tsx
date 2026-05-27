// 농인이 청인 발화를 수어로 보는 결과 화면.
// jetson SignerResultScreen 비주얼 + 데이터는 우리 FlowContext의 lastSpeechToSign.
import { Fragment, useCallback, useMemo, useState } from 'react';

import { ActionBar } from '@/components/action/ActionBar';
import { ActionButton } from '@/components/action/ActionButton';
import { AvatarThreeRenderer } from '@/components/avatar/AvatarThreeRenderer';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { AvatarVideoPlayer } from '@/components/shared/AvatarVideoPlayer';
import { SignerAvatarStage } from '@/components/signer/SignerAvatarStage';
import {
  type SignerPlaybackSpeed,
  SignerSpeedPills,
} from '@/components/signer/SignerSpeedPills';
import { SignerStateBadge } from '@/components/signer/SignerStateBadge';
import { useFlow } from '@/hooks/useFlow';
import type { ViewerFrame } from '@/lib/avatar-renderer/avatarTypes';
import { normalizeAvatarPayload } from '@/lib/avatar-renderer/normalizeAvatarPayload';

export const SignerResultScreen = () => {
  const { state, dispatch, lastSpeechToSign } = useFlow();
  const [playbackSpeed, setPlaybackSpeed] = useState<SignerPlaybackSpeed>(1);
  const [replayNonce, setReplayNonce] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyKeypointSequence, setReadyKeypointSequence] = useState<
    readonly ViewerFrame[] | undefined
  >(undefined);

  const glosses = lastSpeechToSign?.glosses ?? [];
  const avatarPayload = useMemo(
    () => normalizeAvatarPayload(lastSpeechToSign?.keypoint_payload),
    [lastSpeechToSign?.keypoint_payload],
  );
  const avatarFrames = avatarPayload.frames;
  const canPlayAvatar = avatarFrames !== undefined && readyKeypointSequence === avatarFrames;

  const handleReplay = () => {
    if (isPlaying) return;
    setReplayNonce((n) => n + 1);
    dispatch({ type: 'REPLAY' });
  };

  const handlePlay = () => setIsPlaying(true);
  const handleEnded = () => setIsPlaying(false);
  const handleAvatarReady = useCallback(() => {
    setReadyKeypointSequence(avatarFrames);
  }, [avatarFrames]);

  return (
    <PageLayout header={<StatusBar left={<SignerStateBadge state={state} />} tone="signer" />}>
      <div className="flex h-full flex-col">
        <div className="grid flex-1 grid-cols-2 items-stretch gap-6 overflow-hidden px-6 py-4">
          <div className="min-h-0 min-w-0">
            <SignerAvatarStage>
              <AvatarVideoPlayer
                keypointSequence={avatarFrames}
                fps={avatarPayload.fps}
                playbackSpeed={playbackSpeed}
                replayNonce={replayNonce}
                canPlay={canPlayAvatar}
                onPlay={handlePlay}
                onEnded={handleEnded}
                renderFrame={(frame, frameIndex) => (
                  <AvatarThreeRenderer
                    frame={frame as ViewerFrame}
                    frameIndex={frameIndex}
                    frames={avatarFrames}
                    segments={avatarPayload.segments}
                    onReady={handleAvatarReady}
                  />
                )}
              />
            </SignerAvatarStage>
          </div>
          <div className="flex min-w-0 flex-col gap-5 overflow-y-auto">
            <div className="flex items-center justify-between gap-4">
              <div className="text-signer-action-hover text-2xl font-medium tracking-wider uppercase">
                상대 보낸 내용
              </div>
              <SignerSpeedPills value={playbackSpeed} onChange={setPlaybackSpeed} />
            </div>
            {glosses.length > 0 ? (
              <div className="flex flex-wrap items-center gap-4">
                {glosses.map((gloss, i) => (
                  <Fragment key={`${gloss}-${i}`}>
                    <span className="bg-surface-screen border-signer-bg text-signer-action-hover rounded-lg border px-6 py-3.5 text-3xl leading-tight font-semibold">
                      {gloss}
                    </span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <div className="text-text-muted text-3xl">(결과 없음)</div>
            )}
          </div>
        </div>

        <ActionBar layout="split">
          <ActionButton
            variant="neutral"
            className="w-full"
            onClick={handleReplay}
            disabled={isPlaying}
          >
            다시 보기
          </ActionButton>
          <ActionButton
            variant="signer"
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
