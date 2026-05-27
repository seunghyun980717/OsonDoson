import type { Dispatch } from 'react';
import { useReducer } from 'react';

export type HearingState = 'idle' | 'speaking' | 'loading' | 'delivered' | 'result';

export type HearingAction =
  | { type: 'START_RECORDING' }
  | { type: 'CANCEL' }
  | { type: 'STOP_RECORDING' }
  | { type: 'DELIVERED' }
  | { type: 'RECEIVE_REPLY' }
  | { type: 'REPLAY' }
  | { type: 'ANSWER' }
  | { type: 'RESET' };

const hearingReducer = (state: HearingState, action: HearingAction): HearingState => {
  switch (action.type) {
    case 'START_RECORDING':
      return state === 'idle' ? 'speaking' : state;
    case 'STOP_RECORDING':
      return state === 'speaking' ? 'loading' : state;
    case 'DELIVERED':
      return state === 'loading' ? 'delivered' : state;
    case 'RECEIVE_REPLY':
      // idle 포함 — 농인이 먼저 수어를 시작해 청인이 입력 중이지 않은 상태에서도 결과 도달
      return state === 'idle' || state === 'loading' || state === 'delivered'
        ? 'result'
        : state;
    case 'ANSWER':
      return state === 'result' ? 'speaking' : state;
    case 'REPLAY':
      // 같은 상태값 반환 — Step 6에서 음성 플레이어 reset 필요 시 카운터 추가 검토
      return state;
    case 'CANCEL':
    case 'RESET':
      return 'idle';
    default:
      return state;
  }
};

export type HearingDispatch = Dispatch<HearingAction>;

export const useHearingFlow = () => {
    const [state, dispatch] = useReducer(hearingReducer, 'idle' as HearingState);
    return { state, dispatch };
};