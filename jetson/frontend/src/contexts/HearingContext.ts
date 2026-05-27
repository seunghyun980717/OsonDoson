import { createContext } from 'react';

export type PlaybackSpeed = 0.5 | 1 | 1.5;

export type HearingContextValue = {
  ttsEnabled: boolean;
  toggleTts: () => void;
  playbackSpeed: PlaybackSpeed;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
};

export const HearingContext = createContext<HearingContextValue | null>(null);
