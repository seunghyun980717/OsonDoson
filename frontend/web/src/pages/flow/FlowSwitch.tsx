// android `FlowSwitch.tsx` 미러. reducer state 별로 sub-화면 분기.
import { useFlow } from '@/hooks/useFlow';

import { HearingInputScreen } from './HearingInputScreen';
import { HearingLoadingScreen } from './HearingLoadingScreen';
import { HearingResultScreen } from './HearingResultScreen';
import { SignerInputScreen } from './SignerInputScreen';
import { SignerLoadingScreen } from './SignerLoadingScreen';
import { SignerResultScreen } from './SignerResultScreen';

export const FlowSwitch = () => {
  const { state } = useFlow();

  switch (state) {
    case 'hearing_idle':
    case 'hearing_speaking':
      return <HearingInputScreen />;
    case 'hearing_loading':
      return <HearingLoadingScreen />;
    case 'signer_result':
      return <SignerResultScreen />;
    case 'signer_idle':
    case 'signer_recording':
      return <SignerInputScreen />;
    case 'signer_loading':
      return <SignerLoadingScreen />;
    case 'hearing_result':
      return <HearingResultScreen />;
  }
};
