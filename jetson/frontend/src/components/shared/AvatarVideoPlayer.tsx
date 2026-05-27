import { type ReactNode,useEffect, useRef, useState } from 'react';

// 현재 백엔드 keypoint_payload는 형식이 미확정이라(더미는 signer_keypoints 형식 재사용)
// 이 컴포넌트는 frame의 *모양*에 의존하지 않고 길이/타이밍만 사용한다.
// 실제 그리는 책임은 renderFrame 콜백(AI 팀 three.js AvatarRenderer)에 위임.
type AvatarFrame = unknown;

type AvatarVideoPlayerProps = {
  keypointSequence?: readonly AvatarFrame[];
  playbackSpeed?: number;
  fps?: number;
  replayNonce?: number;
  canPlay?: boolean;
  onPlay?: () => void;
  onEnded?: () => void;
  // three.js AvatarRenderer는 AI 팀에서 진행. 현재는 미제공이라 placeholder로 둠
  renderFrame?: (frame: AvatarFrame, frameIndex: number) => ReactNode;
};

export const AvatarVideoPlayer = ({
  keypointSequence,
  playbackSpeed = 1,
  fps = 30,
  replayNonce = 0,
  canPlay = true,
  onPlay,
  onEnded,
  renderFrame,
}: AvatarVideoPlayerProps) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [ended, setEnded] = useState(false);

  const rafRef = useRef<number | null>(null);
  const baseTimeRef = useRef(0);
  const accumulatedRef = useRef(0);
  const speedRef = useRef(playbackSpeed);
  const onPlayRef = useRef(onPlay);
  const onEndedRef = useRef(onEnded);

  // ref 업데이트는 effect로 (render 중 ref 수정 금지 룰 통과용)
  useEffect(() => {
    onPlayRef.current = onPlay;
  }, [onPlay]);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const totalFrames = keypointSequence?.length ?? 0;
  const frameDurationMs = 1000 / fps;

  // 새 시퀀스 도착 / replayNonce 변경 시 처음부터 재생
  useEffect(() => {
    if (!keypointSequence || totalFrames === 0) {
      return;
    }

    if (!canPlay) {
      return;
    }

    accumulatedRef.current = 0;
    baseTimeRef.current = performance.now();
    speedRef.current = playbackSpeed;
    let isFirstTick = true;

    const tick = (now: number) => {
      if (isFirstTick) {
        // 첫 tick에서 인덱스/종료 상태 reset — effect 본문이 아닌 rAF 콜백 컨텍스트
        setFrameIndex(0);
        setEnded(false);
        onPlayRef.current?.();
        isFirstTick = false;
      }

      const elapsed =
        accumulatedRef.current + (now - baseTimeRef.current) * speedRef.current;
      const idx = Math.floor(elapsed / frameDurationMs);
      if (idx <= 1) console.log('[avatar-debug] tick idx', idx, 'elapsed', elapsed.toFixed(1));

      if (idx >= totalFrames) {
        setFrameIndex(totalFrames - 1);
        setEnded(true);
        rafRef.current = null;
        return;
      }

      setFrameIndex(idx);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // playbackSpeed 변경은 별도 effect에서 누적값 보정으로 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypointSequence, replayNonce, fps, canPlay]);

  // playbackSpeed 변경 시 진행 누적값 보정 → 끊김 없이 속도 변경
  const isInitialRef = useRef(true);
  useEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false;
      return;
    }
    if (rafRef.current === null) {
      speedRef.current = playbackSpeed;
      return;
    }
    const now = performance.now();
    accumulatedRef.current += (now - baseTimeRef.current) * speedRef.current;
    baseTimeRef.current = now;
    speedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // 종료 콜백 — render 외부에서 1회 호출
  useEffect(() => {
    if (ended) {
      onEndedRef.current?.();
    }
  }, [ended]);

  const displayedFrameIndex = canPlay ? frameIndex : 0;
  const currentFrame = keypointSequence?.[displayedFrameIndex] ?? null;
  const hasSequence = totalFrames > 0;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {currentFrame && renderFrame ? (
        renderFrame(currentFrame, displayedFrameIndex)
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3">
          <div className="border-signer-border bg-surface-screen text-text-muted relative flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed">
            <span className="text-[clamp(96px,18vh,260px)] leading-none">🧍</span>
            <span className="text-text-muted absolute right-3 bottom-2 text-xs tracking-wider uppercase opacity-60">
              {hasSequence ? 'Renderer Slot' : 'Placeholder'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
