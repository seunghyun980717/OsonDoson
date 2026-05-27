import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { SignerFrame } from '@/lib/api/types';

export type SignerDetectionKind =
  | 'preparing'
  | 'missing-hands'
  | 'good';

const POLL_INTERVAL_MS = 150;
// 'good' 상태가 이 시간 이상 연속 유지돼야 isStable=true (히스테리시스 — mediapipe 검출 1-2프레임 드롭 차단).
// 800→200 단축: 짧은 사인(예: '감사합니다')에 들어가는 프레임 수를 늘려 BE 모델에 더 많은 컨텍스트 제공.
// AI팀의 short-sign 처리 개선 후엔 다시 조정 가능.
const STABLE_MS = 200;

const deriveKind = (
  isReady: boolean,
  frame: SignerFrame | null,
): SignerDetectionKind => {
  if (!isReady || !frame) return 'preparing';
  const hasHand =
    frame.leftHandLandmarks.length > 0 || frame.rightHandLandmarks.length > 0;
  if (!hasHand) return 'missing-hands';
  return 'good';
};

type Result = { kind: SignerDetectionKind; isStable: boolean };

/**
 * latestFrameRef를 폴링해 검출 상태(kind)와 안정성(isStable)을 반환.
 *
 * - kind 변화는 바로 반영 — 'good' → 'missing-*' 전환은 즉시 false
 * - isStable은 'good' 상태가 STABLE_MS 이상 연속 유지될 때만 true
 *   (한 번이라도 'good'에서 벗어나면 즉시 false, 다시 누적)
 */
export const useSignerDetectionState = (
  isReady: boolean,
  latestFrameRef: MutableRefObject<SignerFrame | null>,
): Result => {
  const [kind, setKind] = useState<SignerDetectionKind>('preparing');
  const [isStable, setIsStable] = useState(false);
  const goodSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = deriveKind(isReady, latestFrameRef.current);
      const now = performance.now();

      if (next === 'good') {
        if (goodSinceRef.current === null) goodSinceRef.current = now;
      } else {
        goodSinceRef.current = null;
      }

      const stable =
        goodSinceRef.current !== null && now - goodSinceRef.current >= STABLE_MS;

      setKind((prev) => (prev === next ? prev : next));
      setIsStable((prev) => (prev === stable ? prev : stable));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isReady, latestFrameRef]);

  return { kind, isStable };
};
