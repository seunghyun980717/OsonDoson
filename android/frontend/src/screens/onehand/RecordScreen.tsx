// 한손 수어 모집 — 카메라 화면 (좌표 + mp4 동시 수집).
// SignerInputScreen의 SignerRecordingMode 패턴 미러 + Camera ref로 startRecording 추가.
//
// 동시 시작: mp.startExtraction (좌표) + camera.startRecording (mp4). 음성은 모집 대상 아님 → audio=false.
// 종료: 사용자 "수어 완료" 또는 30초 자동 → 양쪽 모두 정리 후 Playback으로.
//   - frames는 mp.stopExtraction이 즉시 반환
//   - videoUri는 camera.stopRecording 후 onRecordingFinished 콜백이 비동기 반환
//   - 둘 다 모이면 useEffect가 Context에 보관 + 다음 화면으로 push
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

import { CameraGuideOverlay } from '@/components/CameraGuideOverlay';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { useHaptic } from '@/hooks/useHaptic';
import { debugLogFrames, useMediaPipeKeypoints } from '@/hooks/useMediaPipeKeypoints';
import { useOneHandSign } from '@/hooks/useOneHandSign';
import { useSignerDetectionState } from '@/hooks/useSignerDetectionState';
import type { SignerFrame } from '@/lib/api/types';
import {
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@/lib/theme';
import { OneHandSignStackParamList } from '@/navigation/OneHandSignStack';

type Navigation = NativeStackNavigationProp<OneHandSignStackParamList, 'Record'>;

const MAX_RECORD_SEC = 30;

const formatTime = (total: number): string => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

// 절대 경로면 file:// prefix 부여 — expo-video / RN Image 등 일관성.
const toFileUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

export const RecordScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();
  const { setFrames, setVideoUri, reset } = useOneHandSign();
  const mp = useMediaPipeKeypoints();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const { kind } = useSignerDetectionState(true);
  const cameraRef = useRef<Camera>(null);

  const [recSeconds, setRecSeconds] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [pendingFrames, setPendingFrames] = useState<SignerFrame[] | null>(null);
  const [exitDialogVisible, setExitDialogVisible] = useState(false);
  // 사용자가 취소한 직후 도착하는 onRecordingFinished를 구분 — 그 path는 Context에 안 넣고 바로 삭제.
  const cancellingRef = useRef(false);

  const isRecording = mp.isExtracting;
  // 두 채널이 모이는 동안 사용자가 다시 누르지 못하게 — finalize 오버레이.
  const isFinalizing = pendingFrames !== null && recordedUri === null;

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // REC 타이머 — extracting 중에만 카운트
  useEffect(() => {
    if (!isRecording) {
      setRecSeconds(0);
      return;
    }
    const timer = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  // 자동 시작 — mp ready + camera mounted + permission OK인 시점.
  // SignerInputScreen은 화면 진입 후 사용자가 "수어 시작" 버튼을 한 번 더 누르지만,
  // 모집 화면은 동의 후 바로 진입하므로 한 번 더 묻지 않고 즉시 녹화 진입.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!hasPermission || !device || !mp.isReady) return;
    if (!cameraRef.current) return;
    autoStartedRef.current = true;

    cameraRef.current.startRecording({
      onRecordingFinished: (video) => {
        const uri = toFileUri(video.path);
        // 취소 시점에 도착하면 Context에 안 넣고 임시 파일만 정리
        if (cancellingRef.current) {
          void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          return;
        }
        setRecordedUri(uri);
      },
      onRecordingError: (err) => {
        console.error('[onehand record] mp4 녹화 오류:', err);
      },
    });

    mp.startExtraction(MAX_RECORD_SEC, (frames) => {
      // 30초 자동 종료 — frames는 콜백 인자, mp4는 stopRecording 콜백으로
      debugLogFrames(frames);
      haptic.medium();
      setPendingFrames(frames);
      void cameraRef.current?.stopRecording().catch((err) => {
        console.error('[onehand record] stopRecording 실패:', err);
      });
    });
  }, [hasPermission, device, mp, haptic]);

  // frames + videoUri 둘 다 모이면 Context에 보관 + 다음 화면.
  useEffect(() => {
    if (pendingFrames === null || recordedUri === null) return;
    setFrames(pendingFrames);
    setVideoUri(recordedUri);
    navigation.navigate('Playback');
  }, [pendingFrames, recordedUri, setFrames, setVideoUri, navigation]);

  const handleStop = () => {
    if (!isRecording) return;
    haptic.medium();
    const frames = mp.stopExtraction();
    debugLogFrames(frames);
    setPendingFrames(frames);
    void cameraRef.current?.stopRecording().catch((err) => {
      console.error('[onehand record] stopRecording 실패:', err);
    });
  };

  const handleRequestExit = useCallback(() => {
    setExitDialogVisible(true);
  }, []);

  const handleConfirmExit = useCallback(() => {
    cancellingRef.current = true;
    setExitDialogVisible(false);
    mp.cancelExtraction();
    void cameraRef.current?.stopRecording().catch(() => {});
    reset();
    navigation.popToTop();
  }, [mp, reset, navigation]);

  const handleCancelExit = useCallback(() => {
    setExitDialogVisible(false);
  }, []);

  // Android 하드웨어 back은 모집 흐름 중에는 그만두기 확인 다이얼로그로 가로채기.
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

  const exitDialog = (
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
  );

  if (!hasPermission) {
    return (
      <PageLayout header={<RoleHeader role="signer" onClose={handleRequestExit} />}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionText}>카메라 / 허락 / 필요</Text>
          <Text style={styles.permissionSub}>{'수어 / 모으다 / 카메라 / 필요\n설정 / 허락'}</Text>
        </View>
        {exitDialog}
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={<RoleHeader role="signer" onClose={handleRequestExit} />}
      footer={
        <View style={styles.actionsRow}>
          <View style={styles.cancelSlot}>
            <PrimaryButton
              label="취소"
              variant="secondary"
              size="lg"
              onPress={handleRequestExit}
            />
          </View>
          <View style={styles.stopSlot}>
            <PrimaryButton
              label="수어 완료"
              variant="signer"
              size="lg"
              onPress={handleStop}
              disabled={!isRecording || isFinalizing}
            />
          </View>
        </View>
      }
    >
      <View style={styles.cameraStage}>
        {device ? (
          <Camera
            ref={cameraRef}
            style={[StyleSheet.absoluteFillObject, styles.cameraMirrored]}
            device={device}
            isActive={true}
            frameProcessor={mp.frameProcessor}
            pixelFormat="rgb"
            video={true}
            audio={false}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.cameraFallback]} />
        )}
        <CameraGuideOverlay />

        <View style={styles.statusOverlay}>
          <View
            style={[
              styles.statusPill,
              kind === 'good' ? styles.statusPillGood : styles.statusPillPreparing,
            ]}
          >
            <Text
              style={[
                styles.statusLabel,
                kind === 'good' ? styles.statusLabelGood : styles.statusLabelPreparing,
              ]}
            >
              {kind === 'good' ? '인식 / 좋다' : '준비'}
            </Text>
          </View>
        </View>

        {!isRecording && !isFinalizing && <View style={styles.dimOverlay} />}

        {isRecording && (
          <View style={styles.recIndicator}>
            <View style={styles.recDot} />
            <Text style={styles.recLabel}>REC · {formatTime(recSeconds)}</Text>
          </View>
        )}

        {isFinalizing && (
          <View style={styles.finalizingOverlay}>
            <Text style={styles.finalizingText}>영상 / 정리</Text>
          </View>
        )}
      </View>
      {exitDialog}
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    gap: spacing[3],
  },
  permissionText: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize['2xl'],
    color: colors.text.primary,
    textAlign: 'center',
  },
  permissionSub: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  // 카메라 stage — SignerInputScreen과 동일 톤(어두운 스테이지 위 오버레이).
  cameraStage: {
    flex: 1,
    backgroundColor: colors.stage.bg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cameraMirrored: {
    transform: [{ scaleX: -1 }],
  },
  cameraFallback: {
    backgroundColor: colors.stage.bg,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.stage.dim,
  },
  statusOverlay: {
    position: 'absolute',
    top: spacing[3],
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  statusPill: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: colors.stage.scrim,
  },
  statusPillPreparing: {
    borderColor: colors.stage.subtleBorder,
  },
  statusPillGood: {
    borderColor: colors.signer.border,
  },
  statusLabel: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
  },
  statusLabelPreparing: {
    color: colors.stage.mutedText,
  },
  statusLabelGood: {
    color: colors.signer.border,
  },
  recIndicator: {
    position: 'absolute',
    top: spacing[3],
    right: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.stage.overlay,
    zIndex: 2,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.status.error.dot,
  },
  recLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.base,
    color: colors.stage.fg,
  },
  finalizingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.stage.wash,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  finalizingText: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.xl,
    color: colors.stage.fg,
  },

  // Footer 1:2 ratio (취소 1, 수어 완료 2)
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
