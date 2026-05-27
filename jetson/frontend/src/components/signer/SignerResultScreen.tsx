import { Fragment, useCallback, useMemo, useState } from 'react';

import { AvatarThreeRenderer } from '@/components/avatar/AvatarThreeRenderer';
import { useSigner } from '@/hooks/useSigner';
import type { ViewerFrame } from '@/lib/avatar-renderer/avatarTypes';
import { normalizeAvatarPayload } from '@/lib/avatar-renderer/normalizeAvatarPayload';

import type { SignerDispatch } from '../../hooks/useSignerFlow';
import { useSignerSession } from '../../hooks/useSignerSession';
import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';
import { AvatarVideoPlayer } from '../shared/AvatarVideoPlayer';
import { SignerAvatarStage } from './SignerAvatarStage';
import { SignerSpeedPills } from './SignerSpeedPills';

// 농인 가독성을 위해 UI 카피는 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
//   - 라벨: '직원이 보낸 내용' → '직원 보낸 내용'
//   - 빈상태: '(아직 도착한 결과가 없습니다)' → '(결과 없음)'

type Props = { dispatch: SignerDispatch };

export const SignerResultScreen = ({ dispatch }: Props) => {
  const { lastResult } = useSignerSession();
  const { playbackSpeed } = useSigner();
  const [replayNonce, setReplayNonce] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readyKeypointSequence, setReadyKeypointSequence] = useState<readonly ViewerFrame[] | undefined>(undefined);

  const glosses = lastResult?.glosses ?? [];
  // 서버의 단일 keypoint_payload만 사용한다. 형식이 맞지 않으면 기존 placeholder가 유지된다.
  const avatarPayload = useMemo(
    () => normalizeAvatarPayload(lastResult?.keypoint_payload),
    [lastResult?.keypoint_payload],
  );
  const avatarFrames = avatarPayload.frames;
  const canPlayAvatar = avatarFrames !== undefined && readyKeypointSequence === avatarFrames;
  console.log(
    '[avatar-debug] frames', avatarFrames?.length,
    'canPlay', canPlayAvatar,
    'rawPayloadFrames', (lastResult?.keypoint_payload as { frames?: unknown[] } | undefined)?.frames?.length,
    'payloadKeys', lastResult?.keypoint_payload ? Object.keys(lastResult.keypoint_payload) : null,
    'coverage', lastResult?.coverage,
    'resolved', lastResult?.resolved_glosses,
    'missing', lastResult?.missing_glosses,
    'keypoint_url', lastResult?.keypoint_url,
    'timings', lastResult?.timings,
  );
  // 농인 화면에는 korean 평문을 노출하지 않고 글로스만 표시

  const handleReplay = () => {
    if (isPlaying) return;
    setReplayNonce((n) => n + 1);
    dispatch({ type: 'REPLAY' });
  };

  // AvatarVideoPlayer가 rAF 첫 tick / 마지막 tick에서 호출 — 부모는 콜백으로만 isPlaying 추적
  const handlePlay = () => setIsPlaying(true);
  const handleEnded = () => setIsPlaying(false);
  const handleAvatarReady = useCallback(() => {
    setReadyKeypointSequence(avatarFrames);
  }, [avatarFrames]);

  return (
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
            <SignerSpeedPills />
          </div>
          {glosses.length > 0 ? (
            <div className="flex flex-wrap items-center gap-4">
              {glosses.map((gloss, i) => (
                <Fragment key={`${gloss}-${i}`}>
                  <span className="bg-surface-screen border-signer-bg text-signer-action-hover rounded-lg border px-6 py-3.5 text-3xl font-semibold leading-tight">
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
          onClick={() => dispatch({ type: 'ANSWER' })}
        >
          답변하기
        </ActionButton>
      </ActionBar>
    </div>
  );
};
