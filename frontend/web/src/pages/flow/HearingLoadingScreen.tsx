// 청인 로딩 — pendingAudioFile(Blob) 받아 speech-to-sign 호출.
// 성공: setLastSpeechToSign + RECEIVE_REPLY → signer_result.
// 인식 실패: recognitionErrorTone='hearing' + JUMP_TO 'hearing_idle' (모달이 retry/cancel 처리).
// 네트워크 실패: networkErrorMessage + JUMP_TO 'hearing_idle' (CANCEL 은 loading 에서 no-op).
import { useEffect, useRef } from 'react';

import { Spinner } from '@/components/feedback/Spinner';
import { StateBadge } from '@/components/hearing/StateBadge';
import { PageLayout } from '@/components/layout/PageLayout';
import { StatusBar } from '@/components/layout/StatusBar';
import { useFlow } from '@/hooks/useFlow';
import { ApiError } from '@/lib/api/client';
import { speechToSign } from '@/lib/api/translation';

const messageFromError = (e: unknown): string => {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return '응답이 늦어지고 있어요. 다시 시도해주세요';
    if (e instanceof TypeError) return '네트워크에 연결되지 않았어요';
    if (e.message) return e.message;
  }
  return '연결에 문제가 있어요. 다시 시도해주세요';
};

export const HearingLoadingScreen = () => {
  const {
    state,
    dispatch,
    pendingAudioFile,
    setPendingAudioFile,
    setLastSpeechToSign,
    setNetworkErrorMessage,
    setNetworkErrorVariant,
    setRecognitionErrorTone,
  } = useFlow();

  // mount 시점 입력값을 ref 로 capture, cancelled 플래그로 unmount/StrictMode 이중실행 가드.
  const blobRef = useRef(pendingAudioFile);

  useEffect(() => {
    let cancelled = false;
    const blob = blobRef.current;
    if (!blob) {
      // 데이터 없이 진입한 경우 — idle 로 복귀
      dispatch({ type: 'JUMP_TO', target: 'hearing_idle' });
      return;
    }

    (async () => {
      try {
        const result = await speechToSign(blob);
        if (cancelled) return;

        setPendingAudioFile(null);

        // 응답은 정상이지만 결과 비음 — 인식 실패 분기
        if (!result || (result.glosses?.length ?? 0) === 0) {
          setRecognitionErrorTone('hearing');
          dispatch({ type: 'JUMP_TO', target: 'hearing_idle' });
          return;
        }

        setLastSpeechToSign(result);
        dispatch({ type: 'RECEIVE_REPLY' });
      } catch (e) {
        if (cancelled) return;
        console.warn('[HearingLoading] speechToSign failed', e);
        setPendingAudioFile(null);
        if (e instanceof ApiError && e.code.startsWith('FASTAPI_')) {
          setNetworkErrorVariant('fastapi_unavailable');
        } else {
          setNetworkErrorMessage(messageFromError(e));
        }
        dispatch({ type: 'JUMP_TO', target: 'hearing_idle' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageLayout header={<StatusBar left={<StateBadge state={state} />} />}>
      <div className="flex h-full flex-col items-center justify-center gap-8 px-8 py-12 text-center">
        <Spinner tone="hearing" size={56} />
        <div className="flex flex-col gap-2">
          <h1 className="text-text-primary text-4xl font-bold">수어로 옮기는 중...</h1>
          <p className="text-text-secondary text-xl">잠시만 기다려주세요</p>
        </div>
      </div>
    </PageLayout>
  );
};
