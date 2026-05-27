// android/frontend/src/hooks/useFlowSystemPolicy.ts 의 web 어댑테이션.
// RN의 BackHandler/AppState 대신 브라우저 popstate/visibilitychange 사용.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { FlowState } from '@/contexts/FlowMachine';
import { useFlow } from '@/hooks/useFlow';

const BACKGROUND_RESET_MS = 5 * 60 * 1000;

type DialogConfig = {
  title: string;
  message?: string;
  tone: 'hearing' | 'signer';
};

const dialogFor = (state: FlowState): DialogConfig | null => {
  switch (state) {
    case 'hearing_speaking':
      return {
        title: '처음 화면으로 돌아갈까요?',
        message: '진행 중인 대화 내용은 저장되지 않아요.',
        tone: 'hearing',
      };
    case 'hearing_loading':
      return {
        title: '처음 화면으로 돌아갈까요?',
        message: '처리 중인 결과는 받지 않아요.',
        tone: 'hearing',
      };
    case 'signer_recording':
      return {
        title: '처음 화면으로 돌아갈까요?',
        message: '진행 중인 대화 내용은 저장되지 않아요.',
        tone: 'signer',
      };
    case 'signer_loading':
      return {
        title: '처음 화면으로 돌아갈까요?',
        message: '처리 중인 결과는 받지 않아요.',
        tone: 'signer',
      };
    default:
      return null;
  }
};

const needsConfirm = (state: FlowState): boolean => dialogFor(state) !== null;

export const useFlowSystemPolicy = () => {
  const navigate = useNavigate();
  const { state } = useFlow();
  const [confirmVisible, setConfirmVisible] = useState(false);

  // popstate 핸들러가 항상 최신 state 를 읽을 수 있도록 ref 로 보관.
  // render 중 ref 변형 금지 룰(react-hooks/refs) 회피를 위해 useEffect 동기화.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 브라우저 뒤로가기(popstate). needsConfirm 상태면 history.pushState로 한 번 더 막고 모달 띄움.
  useEffect(() => {
    const handler = () => {
      if (needsConfirm(stateRef.current)) {
        // 모달 띄우고, history는 다시 한 칸 추가해 다음 popstate에 대비
        window.history.pushState(null, '', window.location.href);
        setConfirmVisible(true);
      } else {
        navigate('/', { replace: true });
      }
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [navigate]);

  // visibilitychange — 백그라운드 5분 이상이면 main으로 reset
  useEffect(() => {
    let hiddenAt: number | null = null;
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        if (hiddenAt === null) hiddenAt = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAt !== null) {
        const elapsed = Date.now() - hiddenAt;
        hiddenAt = null;
        if (elapsed > BACKGROUND_RESET_MS) {
          navigate('/', { replace: true });
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [navigate]);

  const dialogConfig = dialogFor(state);

  return {
    confirmVisible: confirmVisible && dialogConfig !== null,
    dialogConfig,
    onConfirmAccept: () => {
      setConfirmVisible(false);
      navigate('/', { replace: true });
    },
    onConfirmCancel: () => setConfirmVisible(false),
  };
};
