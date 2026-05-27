import type { HearingDispatch } from '@/hooks/useHearingFlow';

import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';

type HearingDeliveredScreenProps = {
  dispatch: HearingDispatch;
};

export const HearingDeliveredScreen = ({ dispatch }: HearingDeliveredScreenProps) => {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 text-center">
        <div className="bg-hearing-action flex size-[56px] items-center justify-center rounded-full shadow-[0_6px_16px_rgba(181,174,229,0.45)]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="white"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="text-text-primary text-4xl font-semibold">고객에게 전달되었습니다</div>
        <div className="text-text-muted text-2xl leading-relaxed">
          고객의 답변을 기다리고 있습니다...
        </div>
      </div>

      <ActionBar layout="split">
        <ActionButton
          variant="neutral"
          className="w-full"
          onClick={() => dispatch({ type: 'RESET' })}
        >
          처음으로
        </ActionButton>
        <ActionButton
          variant="hearing"
          className="w-full"
          onClick={() => dispatch({ type: 'RECEIVE_REPLY' })}
        >
          답변 받기 →
        </ActionButton>
      </ActionBar>
    </div>
  );
};
