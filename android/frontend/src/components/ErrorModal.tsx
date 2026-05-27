import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

import { PrimaryButton } from './PrimaryButton';

type Tone = 'hearing' | 'signer';

type Props = {
  visible: boolean;
  title: string;
  description: string;
  tone?: Tone;
  retryLabel?: string;
  cancelLabel?: string;
  onRetry: () => void;
  onCancel: () => void;
};

export const ErrorModal = ({
  visible,
  title,
  description,
  tone = 'hearing',
  retryLabel = '다시 시도',
  cancelLabel = '취소',
  onRetry,
  onCancel,
}: Props) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onCancel}
    statusBarTranslucent
  >
    <Pressable style={styles.backdrop} onPress={onCancel}>
      <Pressable style={styles.card} onPress={() => {}}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconMark}>!</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.actions}>
          <View style={styles.actionItem}>
            <PrimaryButton
              label={cancelLabel}
              variant="secondary"
              size="md"
              onPress={onCancel}
            />
          </View>
          <View style={styles.actionItem}>
            <PrimaryButton
              label={retryLabel}
              variant={tone}
              size="md"
              onPress={onRetry}
            />
          </View>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  card: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.surface.screen,
    borderRadius: radius.xl,
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[6],
    gap: spacing[3],
  },
  iconCircle: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.status.error.dot,
    marginBottom: spacing[2],
  },
  iconMark: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['2xl'],
    color: colors.text.onAccent,
  },
  title: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['2xl'],
    color: colors.text.primary,
    textAlign: 'center',
  },
  description: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.lg,
    lineHeight: 26,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing[3],
  },
  actionItem: {
    flex: 1,
  },
});
