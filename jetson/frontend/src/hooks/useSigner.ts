import { useContext } from 'react';

import { SignerContext } from '@/contexts/SignerContext';

export const useSigner = () => {
  const ctx = useContext(SignerContext);
  if (!ctx) {
    throw new Error('useSigner는 SignerProvider 내부에서 사용되어야 함');
  }
  return ctx;
};
