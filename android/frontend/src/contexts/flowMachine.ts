import type { Dispatch } from 'react';

export type FlowState =
  | 'hearing_idle'
  | 'hearing_speaking'
  | 'hearing_loading'
  | 'signer_result'
  | 'signer_idle'
  | 'signer_recording'
  | 'signer_loading'
  | 'hearing_result';

export type FlowEntry = 'hearing' | 'signer';

export type FlowAction =
  | { type: 'START_INPUT' }
  | { type: 'CANCEL' }
  | { type: 'STOP_INPUT' }
  | { type: 'RECEIVE_REPLY' }
  | { type: 'NEXT_TURN' }
  | { type: 'REPLAY' }
  | { type: 'JUMP_TO'; target: FlowState }; // 에러 모달 재시도/취소 등 상태 가드 우회 진입

export type FlowDispatch = Dispatch<FlowAction>;

export const initialStateFor = (entry: FlowEntry): FlowState =>
  entry === 'hearing' ? 'hearing_idle' : 'signer_idle';

export const flowReducer = (state: FlowState, action: FlowAction): FlowState => {
  switch (action.type) {
    case 'START_INPUT':
      if (state === 'hearing_idle') return 'hearing_speaking';
      if (state === 'signer_idle') return 'signer_recording';
      return state;

    case 'CANCEL':
      if (state === 'hearing_speaking') return 'hearing_idle';
      if (state === 'signer_recording') return 'signer_idle';
      return state;

    case 'STOP_INPUT':
      if (state === 'hearing_speaking') return 'hearing_loading';
      if (state === 'signer_recording') return 'signer_loading';
      return state;

    case 'RECEIVE_REPLY':
      // 청인 발화 처리 완료 → 농인이 결과 봄
      if (state === 'hearing_loading') return 'signer_result';
      // 농인 수어 처리 완료 → 청인이 결과 봄
      if (state === 'signer_loading') return 'hearing_result';
      return state;

    case 'NEXT_TURN':
      // ② 농인이 청인 발화 봄 → 농인 자기 차례 (수어 입력)
      if (state === 'signer_result') return 'signer_idle';
      // ④ 청인이 농인 발화 봄 → 청인 자기 차례 (음성 입력)
      if (state === 'hearing_result') return 'hearing_idle';
      return state;

    case 'REPLAY':
      // 결과 화면에서 아바타/오디오 다시 재생 — 머신 state는 유지, 화면 측에서 replayNonce 카운터 별도 관리
      return state;

    case 'JUMP_TO':
      return action.target;

    default:
      return state;
  }
};
