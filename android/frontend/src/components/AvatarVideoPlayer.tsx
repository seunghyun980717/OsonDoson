// jetson `shared/AvatarVideoPlayer.tsx` RN 변환.
// keypoint frames 모양에 의존 X — 길이/타이밍만 사용.
// 실 3D 렌더는 AI팀의 renderFrame 콜백에서 (현재는 placeholder).
import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

type AvatarFrame = unknown;

type Props = {
  keypointSequence?: readonly AvatarFrame[];
  playbackSpeed?: number;
  fps?: number;
  replayNonce?: number;
  canPlay?: boolean;
  onPlay?: () => void;
  onEnded?: () => void;
  renderFrame?: (frame: AvatarFrame, frameIndex: number) => ReactNode;
};

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const AvatarVideoPlayer = ({
  keypointSequence,
  playbackSpeed = 1,
  fps = 30,
  replayNonce = 0,
  canPlay = true,
  onPlay,
  onEnded,
  renderFrame,
}: Props) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [ended, setEnded] = useState(false);

  const rafRef = useRef<number | null>(null);
  const baseTimeRef = useRef(0);
  const accumulatedRef = useRef(0);
  const speedRef = useRef(playbackSpeed);
  const onPlayRef = useRef(onPlay);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onPlayRef.current = onPlay;
  }, [onPlay]);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const totalFrames = keypointSequence?.length ?? 0;
  const frameDurationMs = 1000 / fps;

  // 새 시퀀스 / replayNonce 변경 시 처음부터 재생
  useEffect(() => {
    if (!keypointSequence || totalFrames === 0) return;
    if (!canPlay) return;

    accumulatedRef.current = 0;
    baseTimeRef.current = now();
    speedRef.current = playbackSpeed;
    let isFirstTick = true;

    const tick = (timestamp: number) => {
      if (isFirstTick) {
        setFrameIndex(0);
        setEnded(false);
        onPlayRef.current?.();
        isFirstTick = false;
      }

      const elapsed =
        accumulatedRef.current + (timestamp - baseTimeRef.current) * speedRef.current;
      const idx = Math.floor(elapsed / frameDurationMs);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypointSequence, replayNonce, fps, canPlay]);

  // playbackSpeed 변경 시 진행 누적값 보정
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
    const t = now();
    accumulatedRef.current += (t - baseTimeRef.current) * speedRef.current;
    baseTimeRef.current = t;
    speedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (ended) onEndedRef.current?.();
  }, [ended]);

  const displayedFrameIndex = canPlay ? frameIndex : 0;
  const currentFrame = keypointSequence?.[displayedFrameIndex] ?? null;
  const hasSequence = totalFrames > 0;

  if (currentFrame !== null && renderFrame) {
    return (
      <View style={styles.root}>{renderFrame(currentFrame, displayedFrameIndex)}</View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderGlyph}>🧍</Text>
        <View style={styles.placeholderMeta}>
          {hasSequence && (
            <Text style={styles.frameCounter}>{`${displayedFrameIndex + 1} / ${totalFrames}`}</Text>
          )}
          <Text style={styles.placeholderLabel}>
            {hasSequence ? 'Renderer Slot' : 'Placeholder'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignSelf: 'stretch',
  },
  placeholder: {
    flex: 1,
    backgroundColor: colors.surface.screen,
    borderWidth: 2,
    borderColor: colors.signer.border,
    borderStyle: 'dashed',
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderGlyph: {
    fontSize: 200,
    lineHeight: 220,
  },
  placeholderMeta: {
    position: 'absolute',
    right: spacing[3],
    bottom: spacing[2],
    alignItems: 'flex-end',
    gap: spacing[1],
  },
  frameCounter: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  placeholderLabel: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.xs,
    color: colors.text.muted,
    letterSpacing: 1,
    opacity: 0.6,
  },
});
