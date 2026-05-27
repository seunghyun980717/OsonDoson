// 종료/이탈 확인 다이얼로그. android `ConfirmDialog` 의 웹 어댑테이션.
// useFlowSystemPolicy에서 사용 (브라우저 뒤로가기 / 처음 화면 이동 시).
type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  tone?: 'hearing' | 'signer';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const toneStyles: Record<'hearing' | 'signer', { button: string }> = {
  hearing: { button: 'bg-hearing-action hover:bg-hearing-action-hover text-hearing-action-fg' },
  signer: { button: 'bg-signer-action hover:bg-signer-action-hover text-signer-action-fg' },
};

export const ConfirmDialog = ({
  visible,
  title,
  message,
  tone = 'hearing',
  confirmLabel = '처음으로',
  cancelLabel = '계속하기',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-surface-screen flex w-full max-w-[460px] flex-col gap-4 rounded-2xl px-8 pt-8 pb-6 text-center shadow-[0_24px_48px_rgba(0,0,0,0.22),0_4px_12px_rgba(0,0,0,0.08)]">
        <div
          id="confirm-dialog-title"
          className="text-text-primary text-3xl font-bold whitespace-pre-line"
        >
          {title}
        </div>
        {message && (
          <div className="text-text-secondary text-xl leading-relaxed whitespace-pre-line">
            {message}
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="border-border-default text-text-primary rounded-xl border bg-neutral-100 px-7 py-4 text-2xl font-semibold transition-transform active:scale-[0.98]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-7 py-4 text-2xl font-semibold transition-transform active:scale-[0.98] ${toneStyles[tone].button}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
