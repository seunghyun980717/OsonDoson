// 한손 수어 모집 — 방금 녹화한 mp4 다시 재생.
// videoUri는 OneHandSignContext에 보관된 상태(프론트만 보관, 서버 전송 X).
// 진입 시 자동 1회 재생, [다시 재생]은 처음으로 seek + play.
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { useHaptic } from '@/hooks/useHaptic';
import { useOneHandSign } from '@/hooks/useOneHandSign';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { OneHandSignStackParamList } from '@/navigation/OneHandSignStack';

type Navigation = NativeStackNavigationProp<OneHandSignStackParamList, 'Playback'>;

export const PlaybackScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();
  const { videoUri, reset } = useOneHandSign();

  const [exitDialogVisible, setExitDialogVisible] = useState(false);

  // useVideoPlayer는 source 변경 시 재초기화. 모집 흐름에서는 한 번만 진입하므로 안정.
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
    p.play();
  });

  const handleReplay = () => {
    haptic.medium();
    player.currentTime = 0;
    player.play();
  };

  const handleNext = () => {
    haptic.medium();
    navigation.navigate('GlossInput');
  };

  const handleRequestExit = useCallback(() => {
    setExitDialogVisible(true);
  }, []);

  const handleConfirmExit = useCallback(() => {
    setExitDialogVisible(false);
    reset();
    navigation.popToTop();
  }, [reset, navigation]);

  const handleCancelExit = useCallback(() => {
    setExitDialogVisible(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (exitDialogVisible) return false;
        setExitDialogVisible(true);
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [exitDialogVisible]),
  );

  return (
    <PageLayout
      header={<RoleHeader role="signer" onClose={handleRequestExit} />}
      footer={
        <View style={styles.actionsRow}>
          <View style={styles.replaySlot}>
            <PrimaryButton
              label="다시 재생"
              variant="secondary"
              size="lg"
              onPress={handleReplay}
            />
          </View>
          <View style={styles.nextSlot}>
            <PrimaryButton
              label="다음"
              variant="signer"
              size="lg"
              onPress={handleNext}
              disabled={videoUri === null}
            />
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.videoStage}>
          {videoUri ? (
            <VideoView
              style={[StyleSheet.absoluteFillObject, styles.videoMirrored]}
              player={player}
              contentFit="contain"
              nativeControls={false}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.emptyBox]}>
              <Text style={styles.emptyText}>영상 / 없음</Text>
            </View>
          )}
        </View>

        <View style={styles.caption}>
          <Text style={styles.captionTitle}>수어 / 확인</Text>
          <Text style={styles.captionSub}>{'다시 / 보기\n괜찮다 / 다음'}</Text>
        </View>
      </View>

      <ConfirmDialog
        visible={exitDialogVisible}
        tone="signer"
        title="수어 모집을 그만둘까요?"
        message="지금까지 찍은 좌표와 영상은 보내지지 않고 사라져요."
        confirmLabel="그만두기"
        cancelLabel="계속하기"
        onConfirm={handleConfirmExit}
        onCancel={handleCancelExit}
      />
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing[4],
  },
  // 카메라 stage와 같은 어두운 톤 유지.
  videoStage: {
    flex: 1,
    backgroundColor: colors.stage.bg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // front 카메라 녹화 원본은 좌우 반전되지 않은 상태라, 셀카처럼 보이도록 표시 단계에서 미러링.
  videoMirrored: {
    transform: [{ scaleX: -1 }],
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.lg,
    color: colors.stage.fg,
  },
  caption: {
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.border.light,
  },
  captionTitle: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    color: colors.text.primary,
    textAlign: 'center',
  },
  captionSub: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  // Footer 1:1 ratio (다시 재생 / 다음 동일 폭)
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  replaySlot: {
    flex: 1,
  },
  nextSlot: {
    flex: 1,
  },
});
