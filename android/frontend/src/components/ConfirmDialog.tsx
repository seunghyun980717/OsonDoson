import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radius, spacing } from '@/lib/theme';

import { PrimaryButton } from './PrimaryButton';

type Tone = 'hearing' | 'signer';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  visible,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'hearing',
  onConfirm,
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
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
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
              label={confirmLabel}
              variant={tone}
              size="md"
              onPress={onConfirm}
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
    backgroundColor: colors.surface.screen,
    borderRadius: radius.xl,
    padding: spacing[6],
    gap: spacing[5],
  },
  title: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['2xl'],
    color: colors.text.primary,
  },
  message: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    lineHeight: 24,
    color: colors.text.secondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  actionItem: {
    flex: 1,
  },
});
