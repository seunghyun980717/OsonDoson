import { createContext } from 'react';

export type SignerPlaybackSpeed = 0.5 | 1 | 1.5;

export type SignerContextValue = {
  playbackSpeed: SignerPlaybackSpeed;
  setPlaybackSpeed: (speed: SignerPlaybackSpeed) => void;
};

export const SignerContext = createContext<SignerContextValue | null>(null);
