import type { ReactNode } from 'react';

type BadgeVariant = 'idle' | 'hearing' | 'signer' | 'done' | 'error';

type BadgeProps = {
    variant: BadgeVariant;
    children: ReactNode;
    dot?: boolean;
};

const variantStyles: Record<
    BadgeVariant,
    { bg: string; text: string; dot: string }
> = {
    idle: {
        bg: 'bg-status-info-bg',
        text: 'text-status-info-text',
        dot: 'bg-status-info-dot',
    },
    hearing: {
        bg: 'bg-hearing-bg',
        text: 'text-hearing-action-fg',
        dot: 'bg-hearing-dot',
    },
    signer: {
        bg: 'bg-signer-bg',
        text: 'text-signer-action-fg',
        dot: 'bg-signer-dot',
    },
    done: {
        bg: 'bg-status-info-bg',
        text: 'text-status-info-text',
        dot: 'bg-status-info-dot',
    },
    error: {
        bg: 'bg-status-error-bg',
        text: 'text-status-error-text',
        dot: 'bg-status-error-dot',
    },
};

export const Badge = ({ variant, children, dot = true }: BadgeProps) => {
    const styles = variantStyles[variant];
    return (
        <span
            className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-medium ${styles.bg} ${styles.text}`}
            >
                {dot && <span className={`h-2 w-2 rounded-pill ${styles.dot}`} />}
                {children}
        </span>
    )
}