import type { ReactNode } from 'react';

type PageLayoutProps = {
  header?: ReactNode;
  notification?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export const PageLayout = ({ header, notification, footer, children }: PageLayoutProps) => {
  return (
    // 배경은 페이지(consumer)가 깔도록 비워둠 — 헤더가 페이지 배경 위에 그대로 얹힘
    <div className="flex h-full w-full flex-col">
      {header && <div className="flex-shrink-0">{header}</div>}
      {notification && <div className="flex-shrink-0 px-4 pt-2">{notification}</div>}
      <main className="flex-1 overflow-auto">{children}</main>
      {footer && <div className="flex-shrink-0">{footer}</div>}
    </div>
  );
};
