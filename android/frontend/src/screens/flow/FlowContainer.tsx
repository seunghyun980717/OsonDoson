import { RouteProp, useRoute } from '@react-navigation/native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorModal } from '@/components/ErrorModal';
import { NetworkErrorToast } from '@/components/NetworkErrorToast';
import { FlowProvider } from '@/contexts/FlowProvider';
import { useFlow } from '@/hooks/useFlow';
import { useFlowSystemPolicy } from '@/hooks/useFlowSystemPolicy';
import { RootStackParamList } from '@/navigation/RootStack';

import { FlowSwitch } from './FlowSwitch';

type FlowRoute = RouteProp<RootStackParamList, 'Flow'>;

const FlowSystemBoundary = () => {
  const policy = useFlowSystemPolicy();
  if (!policy.dialogConfig) return null;
  return (
    <ConfirmDialog
      visible={policy.confirmVisible}
      title={policy.dialogConfig.title}
      message={policy.dialogConfig.message}
      tone={policy.dialogConfig.tone}
      confirmLabel="처음으로"
      cancelLabel="계속하기"
      onConfirm={policy.onConfirmAccept}
      onCancel={policy.onConfirmCancel}
    />
  );
};

const FlowNetworkErrorBoundary = () => {
  const { networkErrorMessage, setNetworkErrorMessage } = useFlow();
  return (
    <NetworkErrorToast
      visible={networkErrorMessage !== null}
      message={networkErrorMessage ?? ''}
      onDismiss={() => setNetworkErrorMessage(null)}
    />
  );
};

const RecognitionErrorBoundary = () => {
  const { recognitionErrorTone, setRecognitionErrorTone, dispatch } = useFlow();
  if (recognitionErrorTone === null) return null;

  const isHearing = recognitionErrorTone === 'hearing';
  const config = isHearing
    ? {
        title: '음성을 인식하지 못했어요',
        description: '주변 소음을 줄이고\n마이크 가까이에서 다시 말씀해주세요',
        retryTo: 'hearing_speaking' as const,
        cancelTo: 'hearing_idle' as const,
      }
    : {
        title: '수어 인식 못함',
        description: '화면 / 상체 보이게\n다시 시도',
        retryTo: 'signer_recording' as const,
        cancelTo: 'signer_idle' as const,
      };

  const dismiss = () => setRecognitionErrorTone(null);

  return (
    <ErrorModal
      visible
      tone={recognitionErrorTone}
      title={config.title}
      description={config.description}
      onRetry={() => {
        dispatch({ type: 'JUMP_TO', target: config.retryTo });
        dismiss();
      }}
      onCancel={() => {
        dispatch({ type: 'JUMP_TO', target: config.cancelTo });
        dismiss();
      }}
    />
  );
};

export const FlowContainer = () => {
  const route = useRoute<FlowRoute>();
  const { entry } = route.params;

  return (
    <FlowProvider entry={entry}>
      <FlowSwitch />
      <FlowSystemBoundary />
      <FlowNetworkErrorBoundary />
      <RecognitionErrorBoundary />
    </FlowProvider>
  );
};
