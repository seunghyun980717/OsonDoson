import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/lib/theme';

// jetson SignerGuideFrame 미러 + 모바일 세로 화면 비율 보정.
// 권장 위치 영역(상반신 + 양팔) 가이드. 수어는 양팔 펼침이 자주 있어 가로는 거의 풀폭.
// SVG 없이 RN View + border만으로 구성.
// 카메라/녹화 화면 위에 absolute로 마운트 (`pointerEvents="none"`로 터치 차단 X).
//
// 비율 (lock-in 2026-05-10): 폰 세로 카메라 기준
//   - 가로 left/right 5% (양팔 펼침 보장)
//   - 세로 top 10% / bottom 12% (머리 위·손 아래 약간 여백)
// jetson은 가로 모니터라 left/right 22%였지만 모바일 세로엔 부적합 → 좁게 조정.
export const CameraGuideOverlay = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <View style={[styles.corner, styles.topLeft]} />
    <View style={[styles.corner, styles.topRight]} />
    <View style={[styles.corner, styles.bottomLeft]} />
    <View style={[styles.corner, styles.bottomRight]} />
  </View>
);

const CORNER_SIZE = 48;
const CORNER_BORDER = 3;

const styles = StyleSheet.create({
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.signer.border,
    opacity: 0.85,
  },
  topLeft: {
    top: '10%',
    left: '5%',
    borderTopWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderTopLeftRadius: radius.lg,
  },
  topRight: {
    top: '10%',
    right: '5%',
    borderTopWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderTopRightRadius: radius.lg,
  },
  bottomLeft: {
    bottom: '12%',
    left: '5%',
    borderBottomWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderBottomLeftRadius: radius.lg,
  },
  bottomRight: {
    bottom: '12%',
    right: '5%',
    borderBottomWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderBottomRightRadius: radius.lg,
  },
});
