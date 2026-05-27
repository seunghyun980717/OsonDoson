import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing } from '@/lib/theme';

const BAR_COUNT = 20;
const BAR_MAX_HEIGHT = 60;
const BAR_MIN_HEIGHT = 4;
const BAR_WIDTH = 4;
const TIMING_MS = 100;

const normalize = (db: number | undefined): number => {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
};

type Props = {
  metering: number | undefined;
  active: boolean;
};

export const Waveform = ({ metering, active }: Props) => {
  const bars = useSharedValue<number[]>(new Array(BAR_COUNT).fill(0));

  useEffect(() => {
    if (!active) {
      bars.value = new Array(BAR_COUNT).fill(0);
      return;
    }
    const next = [normalize(metering), ...bars.value.slice(0, BAR_COUNT - 1)];
    bars.value = next;
  }, [metering, active, bars]);

  return (
    <View style={styles.root}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} bars={bars} index={i} />
      ))}
    </View>
  );
};

const Bar = ({ bars, index }: { bars: SharedValue<number[]>; index: number }) => {
  const style = useAnimatedStyle(() => ({
    height: withTiming(
      BAR_MIN_HEIGHT + (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * (bars.value[index] ?? 0),
      { duration: TIMING_MS },
    ),
  }));

  return <Animated.View style={[styles.bar, style]} />;
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_MAX_HEIGHT,
    gap: spacing[1],
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: radius.full,
    backgroundColor: colors.hearing.action,
  },
});
