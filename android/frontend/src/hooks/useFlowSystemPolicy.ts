// 사이클 화면용 시스템 정책 훅.
// 와이어프레임 spec §10-1 (BackHandler) + §10-3 (AppState 5분 reset).
// FlowContainer에서 한 번만 마운트한다.

import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';

import type { FlowState } from '@/contexts/flowMachine';
import { useFlow } from '@/hooks/useFlow';
import { RootStackParamList } from '@/navigation/RootStack';

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
        title: '처음 화면\n돌아감?',
        message: '진행 내용\n사라짐',
        tone: 'signer',
      };
    case 'signer_loading':
      return {
        title: '처음 화면\n돌아감?',
        message: '처리 중 결과\n사라짐',
        tone: 'signer',
      };
    default:
      return null;
  }
};

const needsConfirm = (state: FlowState): boolean => dialogFor(state) !== null;

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Flow'>;

export const useFlowSystemPolicy = () => {
  const navigation = useNavigation<Navigation>();
  const { state } = useFlow();
  const [confirmVisible, setConfirmVisible] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  // BackHandler — Android 시스템 백 + iOS 가장자리 스와이프 (네이티브 스택 자체에서 처리)는 별도.
  useEffect(() => {
    const onBack = () => {
      if (needsConfirm(stateRef.current)) {
        setConfirmVisible(true);
        return true;
      }
      // idle / result 화면은 다이얼로그 없이 바로 Main
      navigation.goBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigation]);

  // AppState 5분 reset
  useEffect(() => {
    let backgroundedAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        if (backgroundedAt == null) backgroundedAt = Date.now();
      } else if (next === 'active' && backgroundedAt != null) {
        const elapsed = Date.now() - backgroundedAt;
        backgroundedAt = null;
        if (elapsed > BACKGROUND_RESET_MS) {
          navigation.goBack();
        }
      }
    });
    return () => sub.remove();
  }, [navigation]);

  const dialogConfig = dialogFor(state);

  return {
    confirmVisible: confirmVisible && dialogConfig !== null,
    dialogConfig,
    onConfirmAccept: () => {
      setConfirmVisible(false);
      navigation.goBack();
    },
    onConfirmCancel: () => setConfirmVisible(false),
  };
};
