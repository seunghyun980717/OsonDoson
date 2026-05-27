import { Mic } from 'lucide-react';

import type { HearingDispatch } from '../../hooks/useHearingFlow';

type HearingIdleScreenProps = {
  dispatch: HearingDispatch;
};

export const HearingIdleScreen = ({ dispatch }: HearingIdleScreenProps) => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 pt-10 pb-8">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="bg-hearing-bg flex size-[88px] items-center justify-center rounded-full shadow-[0_8px_24px_rgba(181,174,229,0.35)]">
          <Mic
            size={40}
            strokeWidth={1.8}
            className="text-hearing-action-hover"
            aria-hidden="true"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-text-primary text-5xl leading-tight font-bold tracking-[-0.02em] whitespace-pre-line">
            {'음성으로\n대화를 시작해보세요'}
          </h1>
          <p className="text-text-secondary text-2xl leading-relaxed font-medium">
            버튼을 누르고 자연스럽게 말씀해주세요
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'START_RECORDING' })}
        className="bg-hearing-action text-hearing-action-fg hover:bg-hearing-action-hover min-w-[72%] rounded-2xl px-10 py-5 text-3xl font-semibold shadow-[0_6px_14px_rgba(181,174,229,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(181,174,229,0.5)] active:translate-y-0 active:scale-[0.98]"
      >
        음성 입력 시작
      </button>
    </div>
  );
};
