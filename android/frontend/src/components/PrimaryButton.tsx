import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

type Variant = 'hearing' | 'signer' | 'secondary';

// 사이즈 규칙 (디자인 시스템):
//   xl — 진입 화면(Main)의 핵심 CTA. 가장 크고 굵게.
//   lg — 일반 흐름 CTA. 사이클 화면 메인 액션 + 결과 화면처럼 secondary와 짝지어 노출되는 경우 둘 다 lg.
//   md — 모달 안의 컴팩트 액션 (ConfirmDialog, ErrorModal).
// 같은 화면에서 짝으로 노출되는 버튼은 사이즈를 맞춰서 위계가 흔들리지 않게 한다.
type Size = 'xl' | 'lg' | 'md';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
};

const heightBy: Record<Size, number> = { xl: 76, lg: 60, md: 52 };
const labelSizeBy: Record<Size, number> = {
  xl: fontSize['2xl'],
  lg: fontSize.xl,
  md: fontSize.lg,
};

const palette = {
  hearing: {
    bg: colors.hearing.action,
    bgPressed: colors.hearing.actionHover,
    fg: colors.hearing.actionFg,
    border: colors.hearing.action,
  },
  signer: {
    bg: colors.signer.action,
    bgPressed: colors.signer.actionHover,
    fg: colors.signer.actionFg,
    border: colors.signer.action,
  },
  secondary: {
    bg: 'transparent',
    bgPressed: colors.border.light,
    fg: colors.text.primary,
    border: colors.border.default,
  },
};

export const PrimaryButton = ({
  label,
  onPress,
  variant = 'hearing',
  size = 'lg',
  disabled,
}: Props) => {
  const tone = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.root,
        {
          height: heightBy[size],
          backgroundColor: pressed ? tone.bgPressed : tone.bg,
          borderColor: tone.border,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Text
        style={[styles.label, { color: tone.fg, fontSize: labelSizeBy[size] }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[5],
  },
  label: {
    fontFamily: fontFamily.pretendardSemibold,
  },
});
