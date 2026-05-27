import type { ReactNode } from 'react';

type StatusChipProps = {
  children: ReactNode;
};

export const StatusChip = ({ children }: StatusChipProps) => {
  return (
    <span className="rounded-pill border-border-light text-text-secondary inline-flex items-center gap-1.5 border bg-white/75 px-2.5 py-1 text-xs whitespace-nowrap backdrop-blur-sm">
      <span className="rounded-pill bg-status-online ring-status-online/20 h-1.5 w-1.5 ring-2" />
      {children}
    </span>
  );
};
