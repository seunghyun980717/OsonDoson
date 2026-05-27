import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';

import { useHapticPreference } from './useHapticPreference';

export const useHaptic = () => {
  const { enabled } = useHapticPreference();

  return useMemo(
    () => ({
      medium: () => {
        if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      },
      success: () => {
        if (enabled) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      },
      error: () => {
        if (enabled) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      },
    }),
    [enabled],
  );
};
