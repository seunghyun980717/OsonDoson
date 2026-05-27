import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { SignerAction, SignerDispatch } from '@/hooks/useSignerFlow';
import { useSignerFlow } from '@/hooks/useSignerFlow';
import { useWebSocket } from '@/hooks/useWebSocket';
import type {
  SignerFrame,
  SignerIncomingMessage,
  SignerOutgoingMessage,
  SpeechToSignResult,
} from '@/types/ws';

import type { SignerSessionValue } from './SignerSessionContext';
import { SignerSessionContext } from './SignerSessionContext';

type SignerSessionProviderProps = {
  children: ReactNode;
};

const SIGNER_AUTO_CLEAR_ACTIONS: ReadonlySet<SignerAction['type']> = new Set([
  'START_RECORDING',
  'CANCEL',
  'RESET',
  'ANSWER',
]);

// 수어 인식/sign_to_speech 파이프라인 실패 — 사용자에게 수어 인식 실패 모달로 노출
// (backend/app/websocket/handlers.py 의 send_error 메시지 기준)
const RECOGNITION_FAILURE_MESSAGES: ReadonlySet<string> = new Set([
  'sign_to_speech pipeline failed',
]);

export const SignerSessionProvider = ({ children }: SignerSessionProviderProps) => {
  const { state, dispatch: rawDispatch } = useSignerFlow();
  const [lastResult, setLastResult] = useState<SpeechToSignResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const dispatch = useCallback<SignerDispatch>(
    (action) => {
      if (SIGNER_AUTO_CLEAR_ACTIONS.has(action.type)) {
        setErrorMessage(null);
      }
      rawDispatch(action);
    },
    [rawDispatch],
  );

  const handleMessage = useCallback(
    (msg: SignerIncomingMessage) => {
      switch (msg.type) {
        case 'speech_to_sign_result':
          setLastResult({
            source: msg.source,
            korean: msg.korean,
            glosses: msg.glosses,
            gloss_str: msg.gloss_str,
            keypoint_url: msg.keypoint_url,
            keypoint_path: msg.keypoint_path,
            keypoint_payload: msg.keypoint_payload,
            resolved_glosses: msg.resolved_glosses,
            missing_glosses: msg.missing_glosses,
            coverage: msg.coverage,
            timings: msg.timings,
          });
          dispatch({ type: 'RECEIVE_REPLY' });
          break;
        case 'peer_disconnected':
          // 응답 대기 중에 상대가 끊기면 결과가 못 옴 — RESET 후 에러 표시
          // dispatch(RESET)이 errorMessage를 자동 clear하므로 setErrorMessage는 그 뒤에 호출해 덮어씀
          if (state === 'loading' || state === 'delivered') {
            dispatch({ type: 'RESET' });
            setErrorMessage('상대방과의 연결이 끊겼습니다');
          }
          break;
        case 'peer_unavailable':
          setErrorMessage(msg.message);
          setLastResult(null);
          dispatch({ type: 'RESET' });
          break;
        case 'error':
          // 콘솔 로깅 — AI팀이 새 에러 분기를 추가하거나 기존 메시지를 바꿀 때 빠르게 확인용
          console.warn('[SignerSession] BE error:', msg.message);
          if (RECOGNITION_FAILURE_MESSAGES.has(msg.message)) {
            setRecognitionError(msg.message);
            dispatch({ type: 'CANCEL' });
          } else {
            setErrorMessage(msg.message);
          }
          break;
        case 'connected':
        case 'peer_connected':
        case 'processing':
        case 'pong':
        default:
          break;
      }
    },
    [dispatch, state],
  );

  const { readyState, peerConnected, send } = useWebSocket<
    SignerIncomingMessage,
    SignerOutgoingMessage
  >({
    path: '/ws/signer',
    onMessage: handleMessage,
  });

  const clearError = useCallback(() => setErrorMessage(null), []);
  const clearRecognitionError = useCallback(() => setRecognitionError(null), []);

  const sendKeypoints = useCallback(
    (frames: SignerFrame[]) => {
      send({ type: 'signer_keypoints', frames });
      dispatch({ type: 'STOP_RECORDING' });
      // BE가 signer 채널로 송신 확인 메시지를 보내지 않으므로 WS 송신 직후
      // 자체적으로 delivered로 전이. 이후 청인 답변(speech_to_sign_result) 도달 시
      // RECEIVE_REPLY로 result 진입.
      dispatch({ type: 'DELIVERED' });
    },
    [send, dispatch],
  );

  const value = useMemo<SignerSessionValue>(
    () => ({
      state,
      dispatch,
      readyState,
      peerConnected,
      lastResult,
      errorMessage,
      recognitionError,
      clearError,
      clearRecognitionError,
      sendKeypoints,
    }),
    [
      state,
      dispatch,
      readyState,
      peerConnected,
      lastResult,
      errorMessage,
      recognitionError,
      clearError,
      clearRecognitionError,
      sendKeypoints,
    ],
  );

  return <SignerSessionContext.Provider value={value}>{children}</SignerSessionContext.Provider>;
};
