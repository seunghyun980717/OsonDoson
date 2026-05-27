// 메인 페이지 — 청인/농인 선택.
// jetson MainPage의 비주얼을 베이스로, 라우팅만 ?entry= 쿼리 방식으로 변경.
import { Hand, Mic } from 'lucide-react';
import { Link } from 'react-router-dom';

import { DeviceFrame } from '@/components/layout/DeviceFrame';

// 양쪽에 가벼운 라디얼 — 청인/농인 톤 미리보기
const mainPageBackground =
  'radial-gradient(ellipse 60% 50% at 25% 30%, rgba(181, 174, 229, 0.18) 0%, transparent 65%), ' +
  'radial-gradient(ellipse 60% 50% at 75% 70%, rgba(245, 174, 188, 0.18) 0%, transparent 65%), ' +
  'var(--color-surface-page)';

export const MainPage = () => {
  return (
    <DeviceFrame>
      <div
        className="flex h-full flex-col items-center justify-center gap-12 px-12 py-16"
        style={{ background: mainPageBackground }}
      >
        <h1 className="text-text-primary text-5xl leading-tight font-bold tracking-[-0.02em]">
          어떻게 대화하시겠어요?
        </h1>

        <div className="flex w-full max-w-[640px] flex-col gap-5">
          <Link
            to="/flow?entry=hearing"
            className="bg-hearing-action text-hearing-action-fg hover:bg-hearing-action-hover flex w-full items-center justify-center gap-4 rounded-2xl px-10 py-6 text-3xl font-semibold shadow-[0_6px_14px_rgba(181,174,229,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(181,174,229,0.5)] active:translate-y-0 active:scale-[0.98]"
          >
            <Mic size={32} strokeWidth={1.8} aria-hidden="true" />
            음성으로 시작
          </Link>

          <Link
            to="/flow?entry=signer"
            className="bg-signer-action text-signer-action-fg hover:bg-signer-action-hover flex w-full items-center justify-center gap-4 rounded-2xl px-10 py-6 text-3xl font-semibold shadow-[0_6px_14px_rgba(245,174,188,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(245,174,188,0.5)] active:translate-y-0 active:scale-[0.98]"
          >
            <Hand size={32} strokeWidth={1.8} aria-hidden="true" />
            수어로 시작
          </Link>
        </div>
      </div>
    </DeviceFrame>
  );
};
