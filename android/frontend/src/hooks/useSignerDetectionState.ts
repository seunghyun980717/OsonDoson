import { useEffect, useRef, useState } from 'react';

// jetson useSignerDetectionState 인터페이스 미러.
// Stage 4b: mock 타이머 — `isActive=true` 후 STABLE_MS 경과 시 자동으로 `good` + `isStable=true`.
// Stage 5-2: 두 번째 인자로 latestFrameRef를 추가해 MediaPipe 좌표 기반 실 detection으로 교체.
//            kind 분기(missing-face / missing-hands)는 그때 활성화. 현재는 preparing → good 두 단계만.
//
// 사용처: SignerInputScreen Recording 모드에서 자동 REC 트리거 + LiveStatus pill 표시.

export type SignerDetectionKind =
  | 'preparing'
  | 'missing-both'
  | 'missing-face'
  | 'missing-hands'
  | 'good';

type Result = { kind: SignerDetectionKind; isStable: boolean };

const STABLE_MS = 1500;

export const useSignerDetectionState = (isActive: boolean): Result => {
  const [kind, setKind] = useState<SignerDetectionKind>('preparing');
  const [isStable, setIsStable] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isActive) {
      setKind('preparing');
      setIsStable(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      setKind('good');
      setIsStable(true);
    }, STABLE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]);

  return { kind, isStable };
};
