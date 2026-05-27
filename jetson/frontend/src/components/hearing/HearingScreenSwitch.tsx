import type { HearingDispatch, HearingState } from '../../hooks/useHearingFlow';
import { HearingDeliveredScreen } from './HearingDeliveredScreen';
import { HearingIdleScreen } from './HearingIdleScreen';
import { HearingLoadingScreen } from './HearingLoadingScreen';
import { HearingResultScreen } from './HearingResultScreen';
import { HearingSpeakingScreen } from './HearingSpeakingScreen';

type HearingScreenSwitchProps = {
  state: HearingState;
  dispatch: HearingDispatch;
};

export const HearingScreenSwitch = ({ state, dispatch }: HearingScreenSwitchProps) => {
  switch (state) {
    case 'idle':
      return <HearingIdleScreen dispatch={dispatch} />;
    case 'speaking':
      return <HearingSpeakingScreen dispatch={dispatch} />;
    case 'loading':
      return <HearingLoadingScreen />;
    case 'delivered':
      return <HearingDeliveredScreen dispatch={dispatch} />;
    case 'result':
      return <HearingResultScreen dispatch={dispatch} />;
  }
};
