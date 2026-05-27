// 네트워크/서버 에러 토스트. android `NetworkErrorToast` 의 웹 어댑테이션.
// 호출자가 message를 set 하면 표시, 사용자가 닫을 때까지 또는 timeout 후 자동 dismiss.
import { useEffect } from 'react';

type NetworkErrorToastProps = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
};

export const NetworkErrorToast = ({
  visible,
  message,
  onDismiss,
  autoDismissMs = 5000,
}: NetworkErrorToastProps) => {
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [visible, onDismiss, autoDismissMs]);

  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed top-6 left-1/2 z-30 -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="border-status-error-border bg-status-error-bg text-status-error-text pointer-events-auto flex items-center gap-3 rounded-xl border px-5 py-3 shadow-elevated">
        <span className="bg-status-error-dot text-text-on-accent inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-bold">
          !
        </span>
        <span className="text-lg">{message}</span>
        <button
          type="button"
          aria-label="닫기"
          onClick={onDismiss}
          className="text-status-error-text/70 hover:text-status-error-text ml-2 text-2xl leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
};
