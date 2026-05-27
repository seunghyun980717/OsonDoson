// android/frontend/src/hooks/useFlow.ts 미러 — RN 의존성 없음.
import { useContext } from 'react';

import { FlowContext } from '@/contexts/FlowContext';

export const useFlow = () => {
  const ctx = useContext(FlowContext);
  if (ctx === null) {
    throw new Error('useFlow must be used inside <FlowProvider>');
  }
  return ctx;
};
