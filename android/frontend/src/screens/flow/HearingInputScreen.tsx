import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { Waveform } from '@/components/Waveform';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import { useMicRecording } from '@/hooks/useMicRecording';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Flow'>;

const formatDuration = (millis: number): string => {
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const HearingInputScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { state, dispatch, setPendingAudioFile } = useFlow();
  const haptic = useHaptic();
  const mic = useMicRecording();

  const isSpeaking = state === 'hearing_speaking';
  const autoStartedRef = useRef(false);

  const handleStart = async () => {
    const ok = await mic.start();
    if (!ok) return;
    haptic.medium();
    dispatch({ type: 'START_INPUT' });
  };

  // ErrorModal "다시 시도"가 JUMP_TO 'hearing_speaking'으로 보냈을 때 녹음 자동 시작.
  // 사용자가 직접 handleStart 거친 경우엔 mic.isRecording이 true라 중복 호출 X.
  useEffect(() => {
    if (state !== 'hearing_speaking') {
      autoStartedRef.current = false;
      return;
    }
    if (mic.isRecording || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void mic.start();
  }, [state, mic]);

  const handleStop = async () => {
    haptic.medium();
    const file = await mic.stop();
    if (!file) {
      // 녹음 파일 누락 — 전송 불가, Idle 복귀
      dispatch({ type: 'CANCEL' });
      return;
    }
    setPendingAudioFile(file);
    dispatch({ type: 'STOP_INPUT' });
  };

  const handleCancel = async () => {
    await mic.stop();
    dispatch({ type: 'CANCEL' });
  };

  const handleClose = () => {
    navigation.replace('Main');
  };

  return (
    <PageLayout
      header={<RoleHeader role="hearing" onClose={isSpeaking ? handleClose : undefined} />}
      footer={
        isSpeaking ? (
          <View style={styles.actionsRow}>
            <View style={styles.cancelSlot}>
              <PrimaryButton label="취소" variant="secondary" size="lg" onPress={handleCancel} />
            </View>
            <View style={styles.stopSlot}>
              <PrimaryButton label="녹음 종료" variant="hearing" size="lg" onPress={handleStop} />
            </View>
          </View>
        ) : undefined
      }
    >
      {isSpeaking ? (
        <View style={styles.body}>
          <Text style={styles.timer}>{formatDuration(mic.durationMillis)}</Text>
          <Waveform metering={mic.metering} active={mic.isRecording} />
          <Text style={styles.guide}>
            {'듣고 있어요.\n다 말씀하시면 종료를 눌러주세요.'}
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Pressable
            onPress={handleStart}
            accessibilityRole="button"
            accessibilityLabel="음성 입력 시작"
            style={({ pressed }) => [styles.micCircle, pressed && styles.micCirclePressed]}
          >
            <Text style={styles.micIcon}>🎙</Text>
          </Pressable>
          <Text style={styles.guide}>
            {'마이크를 누르면\n음성 입력을 시작해요.'}
          </Text>
        </View>
      )}
    </PageLayout>
  );
};

const MIC_CIRCLE_SIZE = 160;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  micCircle: {
    width: MIC_CIRCLE_SIZE,
    height: MIC_CIRCLE_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.hearing.bg,
    borderWidth: 1,
    borderColor: colors.hearing.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCirclePressed: {
    backgroundColor: colors.hearing.border,
    transform: [{ scale: 0.98 }],
  },
  micIcon: {
    fontSize: 64,
  },
  timer: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['3xl'],
    color: colors.text.primary,
  },
  guide: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  cancelSlot: {
    flex: 1,
  },
  stopSlot: {
    flex: 2,
  },
});
