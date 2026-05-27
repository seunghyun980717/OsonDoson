import { useEffect, useRef } from 'react';

import { PageLayout } from '@/components/PageLayout';
import { Spinner } from '@/components/Spinner';
import { fetchMockSignToSpeech } from '@/dev/mock-data';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import { signToSpeech } from '@/lib/api/translation';

// 응답 정상이지만 인식 결과 비음일 때.
// SignToSpeechResult엔 coverage 필드가 없어 glosses.length만 판정.
const isRecognitionFailure = (result: { glosses: string[] }): boolean =>
  result.glosses.length === 0;

// catch한 에러를 종류별 사용자 안내 메시지로 변환 — 농인 holder 글로스 톤.
const messageFromError = (e: unknown): string => {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return '응답 늦음 / 다시';
    if (e instanceof TypeError) return '연결 끊김';
    if (e.message) return e.message;
  }
  return '연결 문제 / 다시 시도';
};

// 농인 발화(수어) → 청인 응답 대기 중. 응답 수신 시 hearing_result로 전환.
// 카피는 농인 holder 시점 글로스 톤. 평문 원본 ↔ 글로스 매핑:
//   "답변을 기다리고 있어요" → "답변\n기다림"
export const SignerLoadingScreen = () => {
  const {
    dispatch,
    setLastSignToSpeech,
    pendingSignFrames,
    setPendingSignFrames,
    setNetworkErrorMessage,
    setRecognitionErrorTone,
  } = useFlow();
  const haptic = useHaptic();

  // mount 시점 frames를 ref로 capture — setPendingSignFrames(null)이 의존성 변경으로
  // useEffect 재실행 시키지 않도록.
  const framesRef = useRef(pendingSignFrames);

  useEffect(() => {
    let cancelled = false;
    const frames = framesRef.current;

    const run = async () => {
      try {
        // frames 있으면 실 호출, null이면(에러 복귀 등) mock fallback
        const result = frames
          ? await signToSpeech({ type: 'signer_keypoints', frames })
          : await fetchMockSignToSpeech(0);
        if (cancelled) return;

        if (frames) setPendingSignFrames(null);

        // 인식 실패 분기 — 응답은 정상이지만 결과 비음
        if (isRecognitionFailure(result)) {
          haptic.error();
          setRecognitionErrorTone('signer');
          // ErrorModal이 사용자 액션을 받아 JUMP_TO. 여기선 추가 dispatch X.
          return;
        }

        setLastSignToSpeech(result);
        haptic.success();
        dispatch({ type: 'RECEIVE_REPLY' });
      } catch (e) {
        if (cancelled) return;
        console.warn('[SignerLoading] signToSpeech failed', e);
        if (frames) setPendingSignFrames(null);
        haptic.error();
        setNetworkErrorMessage(messageFromError(e));
        dispatch({ type: 'JUMP_TO', target: 'signer_idle' });
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [
    setPendingSignFrames,
    setLastSignToSpeech,
    setNetworkErrorMessage,
    setRecognitionErrorTone,
    haptic,
    dispatch,
  ]);

  return (
    <PageLayout>
      <Spinner tone="signer" label={'답변\n기다림'} />
    </PageLayout>
  );
};
