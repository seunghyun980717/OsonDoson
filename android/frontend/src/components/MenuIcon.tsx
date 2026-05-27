// 햄버거 메뉴 아이콘 — ☰ 유니코드 글리프 대신 View 가로선 3개로 그려 두께를 정확히 컨트롤.
import { StyleSheet, View } from 'react-native';

import { colors } from '@/lib/theme';

type Props = {
  size?: number;
  thickness?: number;
  color?: string;
};

export const MenuIcon = ({
  size = 22,
  thickness = 1.5,
  color = colors.text.secondary,
}: Props) => (
  <View style={[styles.root, { width: size, height: size * 0.75 }]}>
    <View style={[styles.line, { height: thickness, backgroundColor: color }]} />
    <View style={[styles.line, { height: thickness, backgroundColor: color }]} />
    <View style={[styles.line, { height: thickness, backgroundColor: color }]} />
  </View>
);

const styles = StyleSheet.create({
  root: {
    justifyContent: 'space-between',
  },
  line: {
    borderRadius: 1,
  },
});
