import type { ReactNode } from 'react';

type StatusBarTone = 'neutral' | 'hearing' | 'signer';

type StatusBarProps = {
  left?: ReactNode;
  right?: ReactNode;
  tone?: StatusBarTone;
};

const toneStyles: Record<StatusBarTone, string> = {
  // 페이지 배경에 그대로 얹히는 헤더 — 별도 경계선/배경 없이
  neutral: '',
  hearing: 'bg-hearing-bg',
  signer: 'bg-signer-bg',
};

export const StatusBar = ({ left, right, tone = 'neutral' }: StatusBarProps) => {
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-between px-4 py-3 ${toneStyles[tone]}`}
    >
      <div className="flex items-center gap-2">{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
};
