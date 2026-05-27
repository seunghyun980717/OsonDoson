import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { type HearingAction,type HearingDispatch,useHearingFlow } from '@/hooks/useHearingFlow';
import { useWebSocket } from '@/hooks/useWebSocket';
import type {
  AudioFormat,
  HearingIncomingMessage,
  HearingOutgoingMessage,
  SignToSpeechResult,
} from '@/types/ws';

import type { HearingSessionValue } from './HearingSessionContext';
import { HearingSessionContext } from './HearingSessionContext';

type HearingSessionProviderProps = {
  children: ReactNode;
};

const HEARING_AUTO_CLEAR_ACTIONS: ReadonlySet<HearingAction['type']> = new Set([
  'START_RECORDING',
  'CANCEL',
  'RESET',
  'ANSWER',
]);

// STT/speech_to_sign 파이프라인 실패 — 사용자에게 음성 인식 실패 모달로 노출
// (backend/app/websocket/handlers.py 의 send_error 메시지 기준)
const RECOGNITION_FAILURE_MESSAGES: ReadonlySet<string> = new Set([
  'speech_to_sign pipeline failed',
]);

export const HearingSessionProvider = ({ children }: HearingSessionProviderProps) => {
  const { state, dispatch: rawDispatch } = useHearingFlow();
  const [lastResult, setLastResult] = useState<SignToSpeechResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const dispatch = useCallback<HearingDispatch>(
    (action) => {
      if (HEARING_AUTO_CLEAR_ACTIONS.has(action.type)) {
        setErrorMessage(null);
      }
      rawDispatch(action);
    },
    [rawDispatch],
  );

  const handleMessage = useCallback(
    (msg: HearingIncomingMessage) => {
      switch (msg.type) {
        case 'sign_to_speech_result':
          setLastResult({
            source: msg.source,
            glosses: msg.glosses,
            korean: msg.korean,
            audio_url: msg.audio_url,
            audio: msg.audio,
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
          if (RECOGNITION_FAILURE_MESSAGES.has(msg.message)) {
            // STT/파이프라인 실패 → 모달로 띄우고 idle 복귀. 사용자가 모달 확인 시 재녹음 시작
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
    HearingIncomingMessage,
    HearingOutgoingMessage
  >({
    path: '/ws/hearing',
    onMessage: handleMessage,
  });

  const clearError = useCallback(() => setErrorMessage(null), []);
  const clearRecognitionError = useCallback(() => setRecognitionError(null), []);

  const sendText = useCallback(
    (text: string) => {
      send({ type: 'hearing_text', text });
      dispatch({ type: 'STOP_RECORDING' });
      // BE가 hearing 채널로 전달 확인 메시지를 보내지 않으므로 WS 송신 직후
      // 자체적으로 delivered로 전이. 이후 농인 답변(sign_to_speech_result) 도달 시
      // RECEIVE_REPLY로 result 진입.
      dispatch({ type: 'DELIVERED' });
    },
    [send, dispatch],
  );

  const sendAudio = useCallback(
    (audioBase64: string, format: AudioFormat) => {
      send({ type: 'hearing_audio', audio_base64: audioBase64, format });
      dispatch({ type: 'STOP_RECORDING' });
      // BE가 hearing 채널로 전달 확인 메시지를 보내지 않으므로 WS 송신 직후
      // 자체적으로 delivered로 전이. 이후 농인 답변(sign_to_speech_result) 도달 시
      // RECEIVE_REPLY로 result 진입.
      dispatch({ type: 'DELIVERED' });
    },
    [send, dispatch],
  );

  const value = useMemo<HearingSessionValue>(
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
      sendText,
      sendAudio,
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
      sendText,
      sendAudio,
    ],
  );

  return <HearingSessionContext.Provider value={value}>{children}</HearingSessionContext.Provider>;
};
