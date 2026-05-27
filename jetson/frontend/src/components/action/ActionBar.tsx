import type { ReactNode } from 'react';

type ActionBarLayout = 'single' | 'split' | 'split-1-2';

type ActionBarProps = {
    layout: ActionBarLayout;
    children: ReactNode;
};

const layoutStyles: Record<ActionBarLayout, string> = {
    single: 'grid-cols-1',
    split: 'grid-cols-2',
    'split-1-2': 'grid-cols-[1fr_2fr',
};

export const ActionBar = ({ layout, children }: ActionBarProps) => {
  return (
    <div
        className={`grid flex-shrink-0 gap-2 border-t border-border-light bg-surface-page px-4 pt-3 pb-4 ${layoutStyles[layout]}`}
    >
        {children}
    </div>
  )
}
