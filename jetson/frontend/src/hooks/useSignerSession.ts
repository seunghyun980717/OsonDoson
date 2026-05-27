import { useContext } from 'react';

import { SignerSessionContext } from '@/contexts/SignerSessionContext';

export const useSignerSession = () => {
  const ctx = useContext(SignerSessionContext);
  if (!ctx) {
    throw new Error('useSignerSession은 SignerSessionProvider 내부에서 사용되어야 함');
  }
  return ctx;
};
