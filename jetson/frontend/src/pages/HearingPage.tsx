import { ConnectionStatusBanner } from '../components/feedback/ConnectionStatusBanner';
import { ErrorInline } from '../components/feedback/ErrorInline';
import { PeerStatusBadge } from '../components/feedback/PeerStatusBadge';
import { RecognitionErrorModal } from '../components/feedback/RecognitionErrorModal';
import { HearingScreenSwitch } from '../components/hearing/HearingScreenSwitch';
import { StateBadge } from '../components/hearing/StateBadge';
import { TtsToggle } from '../components/hearing/TtsToggle';
import { DeviceFrame } from '../components/layout/DeviceFrame';
import { PageLayout } from '../components/layout/PageLayout';
import { StatusBar } from '../components/layout/StatusBar';
import { HearingProvider } from '../contexts/HearingProvider';
import { HearingSessionProvider } from '../contexts/HearingSessionProvider';
import { useHearingSession } from '../hooks/useHearingSession';

// 페이지 전체에 깔리는 배경 — StatusBar 영역까지 동일한 라벤더 톤으로 이어지게
const hearingPageBackground =
  'radial-gradient(ellipse 70% 60% at 20% 15%, rgba(181, 174, 229, 0.22) 0%, transparent 60%), ' +
  'radial-gradient(ellipse 60% 50% at 85% 90%, rgba(181, 174, 229, 0.16) 0%, transparent 65%), ' +
  'var(--color-surface-page)';

// SessionProvider 내부에서만 useHearingSession 호출 가능 — 별도 컴포넌트로 분리
const HearingPageContent = () => {
  const {
    state,
    dispatch,
    readyState,
    peerConnected,
    errorMessage,
    clearError,
    recognitionError,
    clearRecognitionError,
  } = useHearingSession();

  const handleRecognitionRetry = () => {
    clearRecognitionError();
    dispatch({ type: 'START_RECORDING' });
  };

  const showConnectionBanner = readyState !== 'open';
  const showErrorInline = !!errorMessage;
  const notification =
    showConnectionBanner || showErrorInline ? (
      <div className="flex flex-col gap-2">
        {showConnectionBanner && <ConnectionStatusBanner readyState={readyState} />}
        {showErrorInline && <ErrorInline onDismiss={clearError}>{errorMessage}</ErrorInline>}
      </div>
    ) : null;

  return (
    <div className="relative h-full w-full" style={{ background: hearingPageBackground }}>
      <PageLayout
        header={
          <StatusBar
            left={
              <>
                <StateBadge state={state} />
                <PeerStatusBadge peerConnected={peerConnected} peerLabel="고객" />
              </>
            }
            right={<TtsToggle />}
          />
        }
        notification={notification}
      >
        <HearingScreenSwitch state={state} dispatch={dispatch} />
      </PageLayout>

      {recognitionError ? (
        <RecognitionErrorModal
          title="음성을 인식하지 못했어요."
          description={'주변 소음을 줄이고\n마이크 가까이에서 다시 말씀해주세요.'}
          tone="hearing"
          onConfirm={handleRecognitionRetry}
        />
      ) : null}
    </div>
  );
};

export const HearingPage = () => {
  return (
    <DeviceFrame>
      <HearingProvider>
        <HearingSessionProvider>
          <HearingPageContent />
        </HearingSessionProvider>
      </HearingProvider>
    </DeviceFrame>
  );
};
