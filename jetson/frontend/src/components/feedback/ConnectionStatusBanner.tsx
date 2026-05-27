import { useEffect, useState } from 'react';

import type { ReadyState } from '@/hooks/useWebSocket';

type ConnectionStatusBannerProps = {
  readyState: ReadyState;
  // 끊김 노출 임계 (ms). 잠깐 깜빡이는 건 무시. 기본 2000ms
  delayMs?: number;
  // signer tone은 농인 가독성 베이스라인 사이즈 + 글로스 카피 적용. hearing 기본값.
  tone?: 'hearing' | 'signer';
};

// 평문 원본 ↔ 글로스 매핑 (signer tone):
//   - '지금 연결을 다시 시도하고 있어요...' → '연결 / 다시 시도'
const styleConfig = {
  hearing: {
    container: 'gap-4 px-5 py-3.5 text-2xl rounded-xl font-medium',
    dot: 'size-3',
    message: '지금 연결을 다시 시도하고 있어요...',
  },
  signer: {
    container: 'gap-4 px-5 py-3.5 text-2xl rounded-xl font-medium',
    dot: 'size-3',
    message: '연결 / 다시 시도',
  },
} as const;

export const ConnectionStatusBanner = ({
  readyState,
  delayMs = 2000,
  tone = 'hearing',
}: ConnectionStatusBannerProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readyState === 'open') {
      // 연결 복구 시 즉시 배너 숨김 — 외부 readyState 변화에 따른 시각 동기화이므로 의도된 set
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (!cancelled) setVisible(true);
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [readyState, delayMs]);

  if (!visible) return null;

  const style = styleConfig[tone];

  return (
    <div
      className={`border-border-default bg-neutral-100 text-text-primary flex items-center border ${style.container}`}
      role="status"
      aria-live="polite"
    >
      <div className={`flex-shrink-0 animate-pulse rounded-full bg-amber-500 ${style.dot}`} />
      <span>{style.message}</span>
    </div>
  );
};
