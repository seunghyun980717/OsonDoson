// 농인 로딩 — pendingSignFrames 진입 시 sign-to-speech 호출.
// 성공 시: result 저장 + dispatch RECEIVE_REPLY → hearing_result.
// 인식 실패: recognitionErrorTone='signer' + JUMP_TO 'signer_idle'.
// 네트워크 실패: networkErrorMessage + JUMP_TO 'signer_idle' (CANCEL 은 loading 에서 no-op).
import { useEffect, useRef } from 'react';

import { Spinner } from '@/components/feedback/Spinner';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { SignerStateBadge } from '@/components/signer/SignerStateBadge';
import { useFlow } from '@/hooks/useFlow';
import { ApiError } from '@/lib/api/client';
import { signToSpeech } from '@/lib/api/translation';

const messageFromError = (e: unknown): string => {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return '응답 늦음 / 다시';
    if (e instanceof TypeError) return '연결 끊김';
    if (e.message) return e.message;
  }
  return '연결 문제 / 다시 시도';
};

export const SignerLoadingScreen = () => {
  const {
    state,
    dispatch,
    pendingSignFrames,
    setPendingSignFrames,
    setLastSignToSpeech,
    setNetworkErrorMessage,
    setNetworkErrorVariant,
    setRecognitionErrorTone,
  } = useFlow();

  // mount 시점 frames 를 ref 로 capture, cancelled 플래그로 unmount/StrictMode 이중실행 가드.
  const framesRef = useRef(pendingSignFrames);

  useEffect(() => {
    let cancelled = false;
    const frames = framesRef.current;
    if (!frames || frames.length === 0) {
      dispatch({ type: 'JUMP_TO', target: 'signer_idle' });
      return;
    }

    (async () => {
      try {
        const result = await signToSpeech({ type: 'signer_keypoints', frames });
        if (cancelled) return;

        setPendingSignFrames(null);

        if (!result || (result.glosses?.length ?? 0) === 0) {
          setRecognitionErrorTone('signer');
          dispatch({ type: 'JUMP_TO', target: 'signer_idle' });
          return;
        }

        setLastSignToSpeech(result);
        dispatch({ type: 'RECEIVE_REPLY' });
      } catch (e) {
        if (cancelled) return;
        console.warn('[SignerLoading] signToSpeech failed', e);
        setPendingSignFrames(null);
        if (e instanceof ApiError && e.code.startsWith('FASTAPI_')) {
          setNetworkErrorVariant('fastapi_unavailable');
        } else {
          setNetworkErrorMessage(messageFromError(e));
        }
        dispatch({ type: 'JUMP_TO', target: 'signer_idle' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageLayout
      header={<StatusBar left={<SignerStateBadge state={state} />} tone="signer" />}
    >
      <div className="flex h-full flex-col items-center justify-center gap-8 px-8 py-12 text-center">
        <Spinner tone="signer" size={56} />
        <div className="flex flex-col gap-2">
          <h1 className="text-text-primary text-4xl font-bold">음성으로 옮기는 중...</h1>
          <p className="text-text-secondary text-xl">잠시만 기다려주세요</p>
        </div>
      </div>
    </PageLayout>
  );
};
