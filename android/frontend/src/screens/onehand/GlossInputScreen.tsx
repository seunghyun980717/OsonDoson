// 한손 수어 모집 — 방금 찍은 수어가 어떤 단어인지 입력 + 등록 확인 모달 + POST /api/one-hand-signs.
// frames만 서버에 전송. mp4(videoUri)는 ThankYouScreen의 reset()에서 정리(C6에서 cleanup 강화).
import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorModal } from '@/components/ErrorModal';
import { GlossPill } from '@/components/GlossPill';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { useHaptic } from '@/hooks/useHaptic';
import { useOneHandSign } from '@/hooks/useOneHandSign';
import { createOneHandSign } from '@/lib/api/oneHandSign';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { OneHandSignStackParamList } from '@/navigation/OneHandSignStack';

type Navigation = NativeStackNavigationProp<OneHandSignStackParamList, 'GlossInput'>;

const MAX_GLOSS_LENGTH = 20;

export const GlossInputScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();
  const {
    frames,
    setGloss,
    status,
    setStatus,
    errorMessage,
    setErrorMessage,
    reset,
  } = useOneHandSign();

  const [localGloss, setLocalGloss] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [errorVisible, setErrorVisible] = useState(false);
  const [exitDialogVisible, setExitDialogVisible] = useState(false);

  const trimmed = localGloss.trim();
  const isSubmitting = status === 'submitting';
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  // 헤더 ✕는 모집 흐름 자체 종료 → 데이터 폐기 + 첫 화면(Consent)으로.
  // 안드로이드 하드웨어 back은 기본 pop(Playback으로) — frames/videoUri 그대로 유지.
  const handleClose = () => setExitDialogVisible(true);

  const handleConfirmExit = () => {
    setExitDialogVisible(false);
    reset();
    navigation.popToTop();
  };

  const handleConfirmOpen = () => {
    if (!canSubmit) return;
    haptic.medium();
    Keyboard.dismiss();
    setConfirmVisible(true);
  };

  const submit = async () => {
    if (!frames || frames.length === 0) {
      setStatus('error');
      setErrorMessage('좌표 데이터가 비어있어요. 처음부터 다시 진행해 주세요.');
      setErrorVisible(true);
      return;
    }
    try {
      setStatus('submitting');
      setGloss(trimmed);
      await createOneHandSign({ gloss: trimmed, frames });
      setStatus('done');
      navigation.reset({ index: 0, routes: [{ name: 'ThankYou' }] });
    } catch (e) {
      setStatus('error');
      const message =
        e instanceof Error && e.message
          ? e.message
          : '보내는 중에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
      setErrorMessage(message);
      setErrorVisible(true);
    }
  };

  const handleSubmitFromDialog = () => {
    setConfirmVisible(false);
    void submit();
  };

  const handleRetry = () => {
    setErrorVisible(false);
    void submit();
  };

  const handleCancelError = () => {
    setErrorVisible(false);
    setStatus('idle');
  };

  return (
    <PageLayout
      header={<RoleHeader role="signer" onClose={handleClose} />}
      footer={
        <PrimaryButton
          label={isSubmitting ? '보내는 중…' : '확인'}
          variant="signer"
          size="lg"
          onPress={handleConfirmOpen}
          disabled={!canSubmit}
        />
      }
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <GlossPill label="수어 / 뜻 / 무엇?" tone="signer" />
            <Text style={styles.subtitle}>수어 / 이름 / 적다</Text>
          </View>

          <View style={styles.inputBlock}>
            <TextInput
              style={styles.input}
              value={localGloss}
              onChangeText={setLocalGloss}
              placeholder="예: 안녕"
              placeholderTextColor={colors.text.muted}
              maxLength={MAX_GLOSS_LENGTH}
              autoFocus
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleConfirmOpen}
              editable={!isSubmitting}
            />
            <Text style={styles.counter}>
              {localGloss.length} / {MAX_GLOSS_LENGTH}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmVisible}
        tone="signer"
        title="이 단어로 보낼까요?"
        message={`"${trimmed}"\n\n보내면 좌표 데이터가 서버에 저장돼요. 영상은 폰에만 남고 보내지지 않아요.`}
        confirmLabel="보내기"
        cancelLabel="다시 입력"
        onConfirm={handleSubmitFromDialog}
        onCancel={() => setConfirmVisible(false)}
      />

      <ErrorModal
        visible={errorVisible}
        tone="signer"
        title="보내지 못했어요"
        description={errorMessage ?? '잠시 후 다시 시도해 주세요.'}
        retryLabel="다시 시도"
        cancelLabel="취소"
        onRetry={handleRetry}
        onCancel={handleCancelError}
      />

      <ConfirmDialog
        visible={exitDialogVisible}
        tone="signer"
        title="수어 모집을 그만둘까요?"
        message="지금까지 찍은 좌표와 영상은 보내지지 않고 사라져요."
        confirmLabel="그만두기"
        cancelLabel="계속하기"
        onConfirm={handleConfirmExit}
        onCancel={() => setExitDialogVisible(false)}
      />
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    flexGrow: 1,
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
    gap: spacing[6],
  },
  heading: {
    gap: spacing[3],
  },
  subtitle: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: colors.text.secondary,
  },
  inputBlock: {
    gap: spacing[2],
  },
  input: {
    height: 64,
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.screen,
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.xl,
    color: colors.text.primary,
  },
  counter: {
    alignSelf: 'flex-end',
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
});
