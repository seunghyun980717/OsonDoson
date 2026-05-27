// 인식 실패 모달. retry 만 받는 단순 모드 + retry/cancel 둘 다 받는 모드 두 가지.
// 청인/농인 별 톤 색상 차이.
type RecognitionErrorModalProps = {
  title: string;
  description: string;
  tone?: 'hearing' | 'signer';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  // 주어지면 retry/cancel 2-버튼 레이아웃, 없으면 단일 confirm 버튼.
  onCancel?: () => void;
};

const toneActionStyles: Record<'hearing' | 'signer', string> = {
  hearing: 'bg-hearing-action hover:bg-hearing-action-hover text-hearing-action-fg',
  signer: 'bg-signer-action hover:bg-signer-action-hover text-signer-action-fg',
};

const cardStyles = 'max-w-[460px] gap-3 px-8 pt-8 pb-6';

export const RecognitionErrorModal = ({
  title,
  description,
  tone = 'hearing',
  confirmLabel = '다시 시도',
  cancelLabel = '처음으로',
  onConfirm,
  onCancel,
}: RecognitionErrorModalProps) => {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recognition-error-title"
    >
      <div
        className={`bg-surface-screen flex w-full flex-col items-center rounded-2xl text-center shadow-[0_24px_48px_rgba(0,0,0,0.22),0_4px_12px_rgba(0,0,0,0.08)] ${cardStyles}`}
      >
        <div className="mb-3 flex items-center justify-center">
          <svg width={52} height={52} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="11" className="fill-red-500" />
            <path
              d="M12 7v5.5M12 16v.5"
              className="stroke-neutral-0"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div
          id="recognition-error-title"
          className="text-text-primary text-3xl font-bold tracking-tight"
        >
          {title}
        </div>
        <div className="text-text-secondary mb-5 text-2xl leading-relaxed whitespace-pre-line">
          {description}
        </div>
        {onCancel ? (
          <div className="grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="border-border-default text-text-primary rounded-xl border bg-neutral-100 py-4 text-2xl font-semibold transition-transform active:scale-[0.98]"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`rounded-xl py-4 text-2xl font-semibold transition-transform active:scale-[0.98] ${toneActionStyles[tone]}`}
            >
              {confirmLabel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            className={`w-full rounded-xl py-4 text-2xl font-semibold transition-transform active:scale-[0.98] ${toneActionStyles[tone]}`}
          >
            {confirmLabel}
          </button>
        )}
      </div>
    </div>
  );
};
