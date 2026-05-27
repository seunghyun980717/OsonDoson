import { useContext } from 'react';

import { HearingContext } from '@/contexts/HearingContext';

export const useHearing = () => {
  const ctx = useContext(HearingContext);
  if (!ctx) {
    throw new Error('useHearing은 HearingProvider랑 사용되어야 함');
  }
  return ctx;
};
