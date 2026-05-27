import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ActionButtonVariant = 'primary' | 'hearing' | 'signer' | 'danger' | 'neutral';

type ActionButtonProps = {
  variant: ActionButtonVariant;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const variantStyles: Record<ActionButtonVariant, string> = {
  primary: 'bg-neutral-900 text-text-on-accent hover:bg-neutral-600 shadow-card',
  hearing: 'bg-hearing-action text-hearing-action-fg hover:bg-hearing-action-hover shadow-card',
  signer: 'bg-signer-action text-signer-action-fg hover:bg-signer-action-hover shadow-card',
  danger:
    'bg-status-error-bg text-status-error-text border border-status-error-border hover:bg-red-100',
  neutral: 'bg-neutral-100 text-text-primary border border-border-default',
};

export const ActionButton = ({
  variant,
  children,
  className,
  ...rest
}: ActionButtonProps) => {
  return (
    <button
      type="button"
      className={`rounded-xl px-7 py-4 text-2xl font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variantStyles[variant]} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  );
};
