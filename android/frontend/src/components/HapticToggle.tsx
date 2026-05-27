import { StyleSheet, Switch, Text, View } from 'react-native';

import { useHapticPreference } from '@/hooks/useHapticPreference';
import { colors, fontFamily, fontSize, spacing } from '@/lib/theme';

export const HapticToggle = () => {
  const { enabled, setEnabled } = useHapticPreference();

  return (
    <View style={styles.row}>
      <Text style={styles.label}>진동</Text>
      <Switch
        value={enabled}
        onValueChange={setEnabled}
        trackColor={{ false: colors.border.default, true: colors.text.secondary }}
        thumbColor={colors.surface.screen}
        ios_backgroundColor={colors.border.default}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  label: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
});
