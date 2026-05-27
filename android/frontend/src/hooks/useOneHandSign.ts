import { useContext } from 'react';

import { OneHandSignContext } from '@/contexts/OneHandSignContext';

export const useOneHandSign = () => {
  const ctx = useContext(OneHandSignContext);
  if (ctx === null) {
    throw new Error('useOneHandSign must be used inside <OneHandSignProvider>');
  }
  return ctx;
};
