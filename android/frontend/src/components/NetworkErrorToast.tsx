import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

const AUTO_DISMISS_MS = 3000;
const HIDDEN_OFFSET = -120;

type Props = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
};

export const NetworkErrorToast = ({ visible, message, onDismiss }: Props) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 40,
      }).start();
      const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
      return () => clearTimeout(timer);
    }
    Animated.timing(translateY, {
      toValue: HIDDEN_OFFSET,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, onDismiss, translateY]);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.root,
        { top: insets.top + spacing[2], transform: [{ translateY }] },
      ]}
    >
      <Pressable style={styles.toast} onPress={onDismiss}>
        <Text style={styles.message}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
  },
  toast: {
    backgroundColor: colors.status.error.bg,
    borderColor: colors.status.error.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  message: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.base,
    color: colors.status.error.text,
  },
});
