import type { Dispatch } from 'react';
import { useReducer } from 'react';

export type SignerState = 'idle' | 'recording' | 'loading' | 'delivered' | 'result';

export type SignerAction =
  | { type: 'START_RECORDING' }
  | { type: 'CANCEL' }
  | { type: 'STOP_RECORDING' }
  | { type: 'DELIVERED' }
  | { type: 'RECEIVE_REPLY' }
  | { type: 'REPLAY' }
  | { type: 'ANSWER' }
  | { type: 'RESET' };

const signerReducer = (state: SignerState, action: SignerAction): SignerState => {
  switch (action.type) {
    case 'START_RECORDING':
      return state === 'idle' ? 'recording' : state;
    case 'STOP_RECORDING':
      return state === 'recording' ? 'loading' : state;
    case 'DELIVERED':
      return state === 'loading' ? 'delivered' : state;
    case 'RECEIVE_REPLY':
      // idle 포함 — 청인이 먼저 음성/텍스트 입력해 농인이 입력 중이지 않은 상태에서도 결과 도달
      return state === 'idle' || state === 'loading' || state === 'delivered'
        ? 'result'
        : state;
    case 'ANSWER':
      return state === 'result' ? 'recording' : state;
    case 'REPLAY':
      return state;
    case 'CANCEL':
    case 'RESET':
      return 'idle';
    default:
      return state;
  }
};

export type SignerDispatch = Dispatch<SignerAction>;

export const useSignerFlow = () => {
  const [state, dispatch] = useReducer(signerReducer, 'idle' as SignerState);
  return { state, dispatch };
};
