// android FlowContainer 미러. 단일 화면 안에서 reducer state에 따라 6개 sub-화면을 스위칭.
// URL: /flow?entry=hearing | /flow?entry=signer
import { Navigate, useSearchParams } from 'react-router-dom';

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { FastApiUnavailableBanner } from '@/components/feedback/FastApiUnavailableBanner';
import { NetworkErrorToast } from '@/components/feedback/NetworkErrorToast';
import { RecognitionErrorModal } from '@/components/feedback/RecognitionErrorModal';
import { DeviceFrame } from '@/components/layout/DeviceFrame';
import type { FlowEntry } from '@/contexts/FlowMachine';
import { FlowProvider } from '@/contexts/FlowProvider';
import { useFlow } from '@/hooks/useFlow';
import { useFlowSystemPolicy } from '@/hooks/useFlowSystemPolicy';

import { FlowSwitch } from './flow/FlowSwitch';

const FlowSystemBoundary = () => {
  const policy = useFlowSystemPolicy();
  if (!policy.dialogConfig) return null;
  return (
    <ConfirmDialog
      visible={policy.confirmVisible}
      title={policy.dialogConfig.title}
      message={policy.dialogConfig.message}
      tone={policy.dialogConfig.tone}
      onConfirm={policy.onConfirmAccept}
      onCancel={policy.onConfirmCancel}
    />
  );
};

const FlowNetworkErrorBoundary = () => {
  const {
    networkErrorMessage,
    setNetworkErrorMessage,
    networkErrorVariant,
    setNetworkErrorVariant,
  } = useFlow();

  // FastAPI 다운 케이스는 하단 큰 카드 배너 (수동 dismiss) — 일반 네트워크 에러용 상단 토스트와 분리.
  if (networkErrorVariant === 'fastapi_unavailable') {
    return (
      <FastApiUnavailableBanner visible onDismiss={() => setNetworkErrorVariant(null)} />
    );
  }

  return (
    <NetworkErrorToast
      visible={networkErrorMessage !== null}
      message={networkErrorMessage ?? ''}
      onDismiss={() => {
        setNetworkErrorMessage(null);
        setNetworkErrorVariant(null);
      }}
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
        title: '수어를 인식하지 못했어요',
        description: '화면에 상체가 잘 보이도록\n다시 시도해주세요',
        retryTo: 'signer_recording' as const,
        cancelTo: 'signer_idle' as const,
      };

  const dismiss = () => setRecognitionErrorTone(null);

  return (
    <RecognitionErrorModal
      title={config.title}
      description={config.description}
      tone={recognitionErrorTone}
      confirmLabel="다시 시도"
      cancelLabel="처음으로"
      onConfirm={() => {
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

const isValidEntry = (v: string | null): v is FlowEntry => v === 'hearing' || v === 'signer';

export const FlowPage = () => {
  const [params] = useSearchParams();
  const entry = params.get('entry');
  if (!isValidEntry(entry)) {
    return <Navigate to="/" replace />;
  }

  return (
    <DeviceFrame>
      <FlowProvider entry={entry}>
        <FlowSwitch />
        <FlowSystemBoundary />
        <FlowNetworkErrorBoundary />
        <RecognitionErrorBoundary />
      </FlowProvider>
    </DeviceFrame>
  );
};
