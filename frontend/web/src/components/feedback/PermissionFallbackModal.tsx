// 카메라/마이크 권한 거부 또는 MediaRecorder 미지원 시의 안내 모달.
// "다시 시도" + "처음으로" 두 버튼.
type PermissionFallbackModalProps = {
  visible: boolean;
  tone: 'hearing' | 'signer';
  title: string;
  description: string;
  onRetry: () => void;
  onCancel: () => void;
};

const toneStyles: Record<'hearing' | 'signer', { primary: string }> = {
  hearing: { primary: 'bg-hearing-action hover:bg-hearing-action-hover text-hearing-action-fg' },
  signer: { primary: 'bg-signer-action hover:bg-signer-action-hover text-signer-action-fg' },
};

export const PermissionFallbackModal = ({
  visible,
  tone,
  title,
  description,
  onRetry,
  onCancel,
}: PermissionFallbackModalProps) => {
  const styles = toneStyles[tone];

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/45 px-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface-screen flex w-full max-w-[520px] flex-col gap-4 rounded-2xl px-8 pt-8 pb-6 shadow-[0_24px_48px_rgba(0,0,0,0.22)]">
        <div className="text-text-primary text-3xl font-bold whitespace-pre-line">{title}</div>
        <div className="text-text-secondary text-xl leading-relaxed whitespace-pre-line">
          {description}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="border-border-default text-text-primary rounded-xl border bg-neutral-100 px-6 py-4 text-xl font-semibold"
          >
            처음으로
          </button>
          <button
            type="button"
            onClick={onRetry}
            className={`rounded-xl px-6 py-4 text-xl font-semibold transition-transform active:scale-[0.98] ${styles.primary}`}
          >
            다시 시도
          </button>
        </div>
      </div>
    </div>
  );
};
