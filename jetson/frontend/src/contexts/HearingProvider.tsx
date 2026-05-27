import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { HearingContextValue, PlaybackSpeed } from './HearingContext';
import { HearingContext } from './HearingContext';

type HearingProviderProps = {
  children: ReactNode;
};

export const HearingProvider = ({ children }: HearingProviderProps) => {
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => !prev);
  }, []);

  const value = useMemo<HearingContextValue>(
    () => ({ ttsEnabled, toggleTts, playbackSpeed, setPlaybackSpeed }),
    [ttsEnabled, toggleTts, playbackSpeed],
  );

  return <HearingContext.Provider value={value}>{children}</HearingContext.Provider>;
};
