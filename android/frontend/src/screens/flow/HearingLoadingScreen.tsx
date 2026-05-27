import { useEffect, useRef } from 'react';

import { PageLayout } from '@/components/PageLayout';
import { Spinner } from '@/components/Spinner';
import { fetchMockSpeechToSign } from '@/dev/mock-data';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import { speechToSign } from '@/lib/api/translation';

// 응답 정상이지만 인식 실패로 간주할 케이스.
// 백엔드 keypoint pipeline이 coverage를 계산하지 않고 항상 0.0을 반환해 glosses 길이만 검사.
const isRecognitionFailure = (result: { glosses: string[] }): boolean =>
  result.glosses.length === 0;

// catch한 에러를 종류별 사용자 안내 메시지로 변환.
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
    dispatch,
    setLastSpeechToSign,
    pendingAudioFile,
    setPendingAudioFile,
    setNetworkErrorMessage,
    setRecognitionErrorTone,
  } = useFlow();
  const haptic = useHaptic();

  // mount 시점 file을 ref로 capture — setPendingAudioFile(null)이 의존성 변경으로
  // useEffect 재실행 시키지 않도록.
  const fileRef = useRef(pendingAudioFile);

  useEffect(() => {
    let cancelled = false;
    const file = fileRef.current;

    const run = async () => {
      try {
        // file 있으면 실 호출, null이면(에러 복귀 등) mock fallback
        const result = file
          ? await speechToSign(file)
          : await fetchMockSpeechToSign(0);
        if (cancelled) return;

        if (file) setPendingAudioFile(null);

        // 인식 실패 분기 — 응답은 정상이지만 결과 비음
        if (isRecognitionFailure(result)) {
          haptic.error();
          setRecognitionErrorTone('hearing');
          // ErrorModal이 사용자 액션을 받아 JUMP_TO. 여기선 추가 dispatch X.
          return;
        }

        setLastSpeechToSign(result);
        haptic.success();
        dispatch({ type: 'RECEIVE_REPLY' });
      } catch (e) {
        if (cancelled) return;
        console.warn('[HearingLoading] speechToSign failed', e);
        if (file) setPendingAudioFile(null);
        haptic.error();
        setNetworkErrorMessage(messageFromError(e));
        dispatch({ type: 'JUMP_TO', target: 'hearing_idle' });
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [
    setPendingAudioFile,
    setLastSpeechToSign,
    setNetworkErrorMessage,
    setRecognitionErrorTone,
    haptic,
    dispatch,
  ]);

  return (
    <PageLayout>
      <Spinner tone="hearing" label="상대에게 전달하고 있어요" />
    </PageLayout>
  );
};
