type RecognitionErrorModalProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  // signer tone은 색 + 농인 가독성 베이스라인 사이즈 적용. hearing 기본 톤.
  tone?: 'hearing' | 'signer';
  onConfirm: () => void;
};

const toneActionStyles: Record<'hearing' | 'signer', string> = {
  hearing: 'bg-hearing-action hover:bg-hearing-action-hover text-white',
  signer: 'bg-signer-action hover:bg-signer-action-hover text-white',
};

const sizeStyles = {
  hearing: {
    card: 'max-w-[460px] gap-3 px-8 pt-8 pb-6',
    iconWrap: 'mb-3',
    iconSize: 52,
    title: 'text-3xl font-bold',
    description: 'text-2xl mb-5',
    button: 'text-2xl py-4 rounded-xl',
  },
  signer: {
    card: 'max-w-[460px] gap-3 px-8 pt-8 pb-6',
    iconWrap: 'mb-3',
    iconSize: 52,
    title: 'text-3xl font-bold',
    description: 'text-2xl mb-5',
    button: 'text-2xl py-4 rounded-xl',
  },
} as const;

export const RecognitionErrorModal = ({
  title,
  description,
  confirmLabel = '확인',
  tone = 'hearing',
  onConfirm,
}: RecognitionErrorModalProps) => {
  const sz = sizeStyles[tone];
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recognition-error-title"
    >
      <div
        className={`bg-surface-screen flex w-full flex-col items-center rounded-2xl text-center shadow-[0_24px_48px_rgba(0,0,0,0.22),0_4px_12px_rgba(0,0,0,0.08)] ${sz.card}`}
      >
        <div className={`flex items-center justify-center ${sz.iconWrap}`}>
          <svg
            width={sz.iconSize}
            height={sz.iconSize}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
          className={`text-text-primary tracking-tight ${sz.title}`}
        >
          {title}
        </div>
        <div
          className={`text-text-secondary leading-relaxed whitespace-pre-line ${sz.description}`}
        >
          {description}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          className={`w-full font-semibold transition-transform active:scale-[0.98] ${sz.button} ${toneActionStyles[tone]}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
};
