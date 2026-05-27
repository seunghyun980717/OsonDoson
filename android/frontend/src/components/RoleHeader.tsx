import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

type Role = 'hearing' | 'signer';

// 토스·파파고 톤 미러: 헤더 좌측은 보조 액션(다시 재생)만 두고, 모드/페이지 라벨은
// 본문 색·액션 버튼 색으로 자연 표시. 앱 로고도 헤더에 두지 않음(메이저 모바일 룰).
// role prop은 다음 chunk에서 색 분기가 다시 필요할 때 살릴 수 있게 남겨둠.
type Props = {
  role: Role;
  label?: string;
  onClose?: () => void;
  onReplay?: () => void;
};

export const RoleHeader = ({ label, onClose, onReplay }: Props) => (
  <View style={styles.root}>
    <View style={styles.leadingCluster}>
      {label && <Text style={styles.pageLabel}>{label}</Text>}
      {onReplay && (
        <Pressable
          onPress={onReplay}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="다시 재생"
          style={({ pressed }) => [styles.replayBtn, pressed && styles.replayBtnPressed]}
        >
          <Text style={styles.replayGlyph}>▶</Text>
          <Text style={styles.replayLabel}>다시 재생</Text>
        </Pressable>
      )}
    </View>
    {onClose && (
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="닫기"
        style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>
    )}
  </View>
);

const styles = StyleSheet.create({
  root: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leadingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pageLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
  },
  replayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.border.light,
  },
  replayBtnPressed: {
    opacity: 0.7,
  },
  replayGlyph: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize.sm,
    color: colors.text.primary,
  },
  replayLabel: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize.xs,
    color: colors.text.primary,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeBtnPressed: {
    backgroundColor: colors.border.light,
  },
  closeIcon: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.xl,
    color: colors.text.primary,
  },
});
