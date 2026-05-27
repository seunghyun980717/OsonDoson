import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { SignerContextValue, SignerPlaybackSpeed } from './SignerContext';
import { SignerContext } from './SignerContext';

type SignerProviderProps = {
  children: ReactNode;
};

export const SignerProvider = ({ children }: SignerProviderProps) => {
  const [playbackSpeed, setPlaybackSpeed] = useState<SignerPlaybackSpeed>(1);

  const value = useMemo<SignerContextValue>(
    () => ({ playbackSpeed, setPlaybackSpeed }),
    [playbackSpeed],
  );

  return <SignerContext.Provider value={value}>{children}</SignerContext.Provider>;
};
