import type { ReactNode } from 'react';

type ErrorInlineProps = {
  children: ReactNode;
  title?: string;
  onDismiss?: () => void;
  // signer tone은 농인 가독성 베이스라인 사이즈 적용. hearing 기본값.
  tone?: 'hearing' | 'signer';
};

const sizeStyles = {
  hearing: {
    container: 'gap-5 p-5 rounded-xl',
    icon: 'h-9 w-9 text-lg',
    title: 'text-3xl font-bold',
    message: 'text-2xl',
    dismiss: 'text-3xl',
  },
  signer: {
    container: 'gap-5 p-5 rounded-xl',
    icon: 'h-9 w-9 text-lg',
    title: 'text-3xl font-bold',
    message: 'text-2xl',
    dismiss: 'text-3xl',
  },
} as const;

export const ErrorInline = ({
  children,
  title,
  onDismiss,
  tone = 'hearing',
}: ErrorInlineProps) => {
  const sz = sizeStyles[tone];
  return (
    <div
      className={`border-status-error-border bg-status-error-bg flex border ${sz.container}`}
    >
      <span
        className={`rounded-pill text-text-on-accent mt-0.5 inline-flex flex-shrink-0 items-center justify-center bg-red-500 font-bold ${sz.icon}`}
      >
        !
      </span>
      <div className="text-status-error-text flex flex-col gap-1">
        {title && <p className={sz.title}>{title}</p>}
        <div className={sz.message}>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="닫기"
          onClick={onDismiss}
          className={`text-status-error-text/70 hover:text-status-error-text/100 flex-shrink-0 self-start leading-none ${sz.dismiss}`}
        >
          X
        </button>
      )}
    </div>
  );
};
