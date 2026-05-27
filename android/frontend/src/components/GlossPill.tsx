import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

type Tone = 'hearing' | 'signer';
type Size = 'sm' | 'md';

type Props = {
  label: string;
  tone?: Tone;
  size?: Size;
};

// jetson SignerResultScreen 글로스 스타일 미러 — 흰 카드 + 역할 색 light border + 진한 역할 색 text.
// content 카드형으로 보이도록 radius.lg(둥근 사각형). 사이즈는 RecommendScreen candidate pill 톤과 맞춤.
const palette = {
  hearing: {
    border: colors.hearing.bg,
    text: colors.hearing.focusRing,
  },
  signer: {
    border: colors.signer.bg,
    text: colors.signer.focusRing,
  },
};

export const GlossPill = ({ label, tone = 'signer', size = 'md' }: Props) => {
  const tones = palette[tone];

  return (
    <View
      style={[
        styles.card,
        size === 'sm' ? styles.cardSm : styles.cardMd,
        { borderColor: tones.border },
      ]}
    >
      <Text
        style={[
          size === 'sm' ? styles.labelSm : styles.labelMd,
          { color: tones.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface.screen,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  cardMd: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  cardSm: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  labelMd: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.lg,
  },
  labelSm: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.base,
  },
});
