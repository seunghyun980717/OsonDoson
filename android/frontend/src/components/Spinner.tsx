import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, lineHeight, spacing } from '@/lib/theme';

type Tone = 'hearing' | 'signer' | 'neutral';

type Props = {
  tone?: Tone;
  label?: string;
};

const tintByTone: Record<Tone, string> = {
  hearing: colors.hearing.action,
  signer: colors.signer.action,
  neutral: colors.text.secondary,
};

export const Spinner = ({ tone = 'neutral', label }: Props) => (
  <View style={styles.root}>
    <ActivityIndicator size="large" color={tintByTone[tone]} />
    {label && <Text style={styles.label}>{label}</Text>}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
  },
  label: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
