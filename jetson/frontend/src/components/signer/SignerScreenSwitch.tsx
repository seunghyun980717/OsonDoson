import type { SignerDispatch, SignerState } from '../../hooks/useSignerFlow';
import { SignerDeliveredScreen } from './SignerDeliveredScreen';
import { SignerIdleScreen } from './SignerIdleScreen';
import { SignerLoadingScreen } from './SignerLoadingScreen';
import { SignerRecordingScreen } from './SignerRecordingScreen';
import { SignerResultScreen } from './SignerResultScreen';

type SignerScreenSwitchProps = {
  state: SignerState;
  dispatch: SignerDispatch;
};

export const SignerScreenSwitch = ({ state, dispatch }: SignerScreenSwitchProps) => {
  switch (state) {
    case 'idle':
      return <SignerIdleScreen dispatch={dispatch} />;
    case 'recording':
      return <SignerRecordingScreen dispatch={dispatch} />;
    case 'loading':
      return <SignerLoadingScreen />;
    case 'delivered':
      return <SignerDeliveredScreen dispatch={dispatch} />;
    case 'result':
      return <SignerResultScreen dispatch={dispatch} />;
  }
};
