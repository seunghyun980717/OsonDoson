import { useEffect } from 'react';

import { ConnectionStatusBanner } from '../components/feedback/ConnectionStatusBanner';
import { ErrorInline } from '../components/feedback/ErrorInline';
import { PeerStatusBadge } from '../components/feedback/PeerStatusBadge';
import { RecognitionErrorModal } from '../components/feedback/RecognitionErrorModal';
import { DeviceFrame } from '../components/layout/DeviceFrame';
import { PageLayout } from '../components/layout/PageLayout';
import { StatusBar } from '../components/layout/StatusBar';
import { SignerScreenSwitch } from '../components/signer/SignerScreenSwitch';
import { SignerStateBadge } from '../components/signer/SignerStateBadge';
import { SignerProvider } from '../contexts/SignerProvider';
import { SignerSessionProvider } from '../contexts/SignerSessionProvider';
import { preloadMediaPipeKeypoints } from '../hooks/useMediaPipeKeypoints';
import { useSignerSession } from '../hooks/useSignerSession';
import { preloadAvatarModel } from '../lib/avatar-renderer/avatarModelCache';

// 페이지 전체에 깔리는 배경 — StatusBar 영역까지 동일한 코랄 톤으로 이어지게
const signerPageBackground =
  'radial-gradient(ellipse 70% 60% at 20% 15%, rgba(245, 174, 188, 0.22) 0%, transparent 60%), ' +
  'radial-gradient(ellipse 60% 50% at 85% 90%, rgba(245, 174, 188, 0.16) 0%, transparent 65%), ' +
  'var(--color-surface-page)';

const SignerPageContent = () => {
  const {
    state,
    dispatch,
    readyState,
    peerConnected,
    errorMessage,
    clearError,
    recognitionError,
    clearRecognitionError,
  } = useSignerSession();

  useEffect(() => {
    void preloadAvatarModel().catch((error) => {
      console.warn('[SignerPage] Failed to preload avatar model.', error);
    });
    // Jetson 브라우저에서 MediaPipe wasm + landmarker 로딩이 길어 idle 화면 진입 즉시
    // 백그라운드로 모델을 띄워둔다. 녹화 화면 진입 시 캐시된 인스턴스가 곧바로 사용됨.
    preloadMediaPipeKeypoints();
  }, []);

  const handleRecognitionRetry = () => {
    clearRecognitionError();
    dispatch({ type: 'START_RECORDING' });
  };

  const showConnectionBanner = readyState !== 'open';
  const showErrorInline = !!errorMessage;
  const notification =
    showConnectionBanner || showErrorInline ? (
      <div className="flex flex-col gap-2">
        {showConnectionBanner && <ConnectionStatusBanner readyState={readyState} tone="signer" />}
        {showErrorInline && (
          <ErrorInline tone="signer" onDismiss={clearError}>
            {errorMessage}
          </ErrorInline>
        )}
      </div>
    ) : null;

  return (
    <div className="relative h-full w-full" style={{ background: signerPageBackground }}>
      <PageLayout
        header={
          <StatusBar
            left={<SignerStateBadge state={state} />}
            right={<PeerStatusBadge peerConnected={peerConnected} peerLabel="직원" />}
          />
        }
        notification={notification}
      >
        <SignerScreenSwitch state={state} dispatch={dispatch} />
      </PageLayout>

      {/* 농인 가독성을 위해 모달 카피는 글로스 형태로 작성.
          평문 원본 ↔ 글로스 매핑:
            - 인식실패 title: '수어를 인식하지 못했어요.' → '수어 인식 못함'
            - 인식실패 desc:  '화면 안에 상체가 잘 보이도록\n다시 시도해 주세요.' → '화면 / 상체 보이게\n다시 시도' */}
      {recognitionError ? (
        <RecognitionErrorModal
          title="수어 인식 못함"
          description={'화면 / 상체 보이게\n다시 시도'}
          tone="signer"
          onConfirm={handleRecognitionRetry}
        />
      ) : null}
    </div>
  );
};

export const SignerPage = () => {
  return (
    <DeviceFrame>
      <SignerProvider>
        <SignerSessionProvider>
          <SignerPageContent />
        </SignerSessionProvider>
      </SignerProvider>
    </DeviceFrame>
  );
};
