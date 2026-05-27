import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

import { CameraGuideOverlay } from '@/components/CameraGuideOverlay';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import { debugLogFrames, useMediaPipeKeypoints } from '@/hooks/useMediaPipeKeypoints';
import { useSignerDetectionState } from '@/hooks/useSignerDetectionState';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

// 농인 holder 화면. 안내 카피는 글로스 톤. 평문 원본 ↔ 글로스 매핑:
//   "수어로 대화를 시작해보세요"     → "수어\n대화 시작"
//   "버튼을 누르고 천천히 표현해주세요" → "버튼 누름 / 천천히 수어"
//   "수어 시작하기"                   → "수어 시작"
//   "잘 인식되고 있어요"               → "인식 / 좋다"
//   "수어 인식을 준비하고 있어요"     → "준비"
//
// Phase 5: Recording 모드에서 expo-camera 마운트 + useMediaPipeKeypoints 결합.
// Idle 모드는 손 아이콘 hero 유지 (Stage 4b 결정 — 카메라는 Recording 진입 시 활성).
// 자동 startExtraction useEffect는 Stage 6 ErrorModal retry → JUMP_TO 'signer_recording' 흐름도 자연스럽게 받음.
type Navigation = NativeStackNavigationProp<RootStackParamList, 'Flow'>;

const MAX_RECORD_SEC = 30;

const formatTime = (total: number): string => {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const SignerInputScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { state, dispatch, setPendingSignFrames } = useFlow();
  const haptic = useHaptic();
  const mp = useMediaPipeKeypoints();
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const isRecording = state === 'signer_recording';

  // signer_recording 진입 시 자동 startExtraction (Stage 6 ErrorModal retry 흐름 포함)
  // maxDurationSec(30s) 도달 시 사용자가 "수어 완료" 안 눌러도 자동으로 frames 전달 + 다음 화면.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (state !== 'signer_recording') {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    mp.startExtraction(MAX_RECORD_SEC, (frames) => {
      debugLogFrames(frames);
      haptic.medium();
      setPendingSignFrames(frames);
      dispatch({ type: 'STOP_INPUT' });
    });
  }, [state, mp, haptic, setPendingSignFrames, dispatch]);

  const handleStart = () => {
    haptic.medium();
    dispatch({ type: 'START_INPUT' });
  };

  const handleClose = () => {
    mp.cancelExtraction();
    navigation.replace('Main');
  };

  if (isRecording) {
    return (
      <SignerRecordingMode
        mp={mp}
        onClose={handleClose}
        onCancel={() => {
          mp.cancelExtraction();
          dispatch({ type: 'CANCEL' });
        }}
        onStop={() => {
          haptic.medium();
          const frames = mp.stopExtraction();
          debugLogFrames(frames);
          setPendingSignFrames(frames);
          dispatch({ type: 'STOP_INPUT' });
        }}
      />
    );
  }

  return (
    <PageLayout
      header={<RoleHeader role="signer" />}
      footer={
        <PrimaryButton
          label="수어 시작"
          variant="signer"
          size="lg"
          onPress={handleStart}
        />
      }
    >
      <View style={styles.body}>
        <View style={styles.handCircle}>
          <Text style={styles.handIcon}>✋</Text>
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.hero}>{'수어\n대화 시작'}</Text>
          <Text style={styles.sub}>
            {'버튼 누름 '}
            <Text style={styles.subSlash}>/</Text>
            {' 천천히 수어'}
          </Text>
        </View>
      </View>
    </PageLayout>
  );
};

// Recording 모드 — front 카메라 + 좌우 미러링 (셀카) + 자동 REC + 좌·우 액션.
type RecordingProps = {
  mp: ReturnType<typeof useMediaPipeKeypoints>;
  onClose: () => void;
  onCancel: () => void;
  onStop: () => void;
};

const SignerRecordingMode = ({
  mp,
  onClose,
  onCancel,
  onStop,
}: RecordingProps) => {
  const device = useCameraDevice('front');
  const { kind } = useSignerDetectionState(true);
  const [recSeconds, setRecSeconds] = useState(0);

  const isExtracting = mp.isExtracting;

  // REC 타이머 — isExtracting일 때만 카운트
  useEffect(() => {
    if (!isExtracting) {
      setRecSeconds(0);
      return;
    }
    const timer = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isExtracting]);

  return (
    <PageLayout
      header={<RoleHeader role="signer" onClose={onClose} />}
      footer={
        <View style={styles.actionsRow}>
          <View style={styles.cancelSlot}>
            <PrimaryButton
              label="취소"
              variant="secondary"
              size="lg"
              onPress={onCancel}
            />
          </View>
          <View style={styles.stopSlot}>
            <PrimaryButton
              label="수어 완료"
              variant="signer"
              size="lg"
              onPress={onStop}
              disabled={!isExtracting}
            />
          </View>
        </View>
      }
    >
      <View style={styles.cameraStage}>
        {device ? (
          <Camera
            style={[StyleSheet.absoluteFillObject, styles.cameraMirrored]}
            device={device}
            isActive={true}
            frameProcessor={mp.frameProcessor}
            pixelFormat="rgb"
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

        {!isExtracting && <View style={styles.dimOverlay} />}

        {isExtracting && (
          <View style={styles.recIndicator}>
            <View style={styles.recDot} />
            <Text style={styles.recLabel}>REC · {formatTime(recSeconds)}</Text>
          </View>
        )}
      </View>
    </PageLayout>
  );
};

const HAND_CIRCLE_SIZE = 120;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[8],
  },
  handCircle: {
    width: HAND_CIRCLE_SIZE,
    height: HAND_CIRCLE_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.signer.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handIcon: {
    fontSize: 64,
  },
  textGroup: {
    alignItems: 'center',
    gap: spacing[3],
  },
  hero: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['4xl'],
    lineHeight: lineHeight['4xl'],
    color: colors.text.primary,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  subSlash: {
    color: colors.signer.focusRing,
  },

  // Recording 모드
  // 카메라 어두운 stage 위에 띄우는 오버레이 색은 토큰 외 raw로 둠 (#1a1a18 stage / 흑·백 alpha overlay).
  // 토큰화하면 다른 surface와 섞일 위험이 있고, 여기서만 쓰는 dark-only 색이라 의도적 raw.
  cameraStage: {
    flex: 1,
    backgroundColor: '#1a1a18',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // front 카메라 좌우 미러링 (셀카 — 농인이 자기 수어 보면서 입력)
  cameraMirrored: {
    transform: [{ scaleX: -1 }],
  },
  cameraFallback: {
    backgroundColor: '#000',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  statusPillPreparing: {
    borderColor: 'rgba(255,255,255,0.4)',
  },
  statusPillGood: {
    borderColor: colors.signer.border,
  },
  statusLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.base,
  },
  statusLabelPreparing: {
    color: 'rgba(255,255,255,0.85)',
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 2,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.status.error.dot,
  },
  recLabel: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.base,
    color: '#f1efe8',
  },

  // Footer 1:2 ratio
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
