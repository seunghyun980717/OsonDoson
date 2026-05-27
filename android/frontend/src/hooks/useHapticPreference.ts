import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = '@app/haptic_enabled';

let cachedEnabled = true;
let initialized = false;
const subscribers = new Set<(enabled: boolean) => void>();

const broadcast = (next: boolean) => {
  cachedEnabled = next;
  subscribers.forEach((fn) => fn(next));
};

export const useHapticPreference = () => {
  const [enabled, setLocalEnabled] = useState(cachedEnabled);

  useEffect(() => {
    subscribers.add(setLocalEnabled);
    if (!initialized) {
      initialized = true;
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw != null) broadcast(raw === 'true');
      });
    }
    return () => {
      subscribers.delete(setLocalEnabled);
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    broadcast(next);
    await AsyncStorage.setItem(STORAGE_KEY, String(next));
  }, []);

  return { enabled, setEnabled };
};
