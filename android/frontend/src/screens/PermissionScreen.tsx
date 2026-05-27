import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { Camera } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Permission'>;
type PermStatus = 'unknown' | 'granted' | 'denied';
type PermKey = 'mic' | 'camera';

// 농인 가독성 강화 — wireframe spec §9-1의 "(역할 진입 전) → 평문" 원칙에서
// PermissionScreen만 평문 + 글로스 둘 다 노출 (lock-in 2026-05-10).
type PermissionCard = {
  key: PermKey;
  icon: string;
  label: string;
  detailPlain: string;
  detailGloss: string;
  tone: 'hearing' | 'signer';
};

const cards: readonly PermissionCard[] = [
  {
    key: 'mic',
    icon: '🎙',
    label: '마이크',
    detailPlain: '음성 입력할 때 써요',
    detailGloss: '음성 입력 / 사용',
    tone: 'hearing',
  },
  {
    key: 'camera',
    icon: '📷',
    label: '카메라',
    detailPlain: '수어 인식할 때 써요',
    detailGloss: '수어 인식 / 사용',
    tone: 'signer',
  },
];

const mapStatus = (r: { granted: boolean; status: string }): PermStatus => {
  if (r.granted) return 'granted';
  if (r.status === 'denied') return 'denied';
  return 'unknown';
};

export const PermissionScreen = () => {
  const navigation = useNavigation<Navigation>();
  const [micStatus, setMicStatus] = useState<PermStatus>('unknown');
  const [cameraStatus, setCameraStatus] = useState<PermStatus>('unknown');

  const refreshStatuses = useCallback(async () => {
    const [mic, cam] = await Promise.all([
      getRecordingPermissionsAsync(),
      Camera.getCameraPermissionsAsync(),
    ]);
    setMicStatus(mapStatus(mic));
    setCameraStatus(mapStatus(cam));
  }, []);

  // 진입 시 + 포그라운드 복귀 시 갱신 (시스템 설정 다녀온 후 자동 반영)
  useEffect(() => {
    void refreshStatuses();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshStatuses();
    });
    return () => sub.remove();
  }, [refreshStatuses]);

  // 둘 다 granted → Main
  useEffect(() => {
    if (micStatus !== 'granted' || cameraStatus !== 'granted') return;
    navigation.replace('Main');
  }, [micStatus, cameraStatus, navigation]);

  const handleCardTap = async (key: PermKey) => {
    if (key === 'mic') {
      const r = await requestRecordingPermissionsAsync();
      setMicStatus(mapStatus(r));
    } else {
      const r = await Camera.requestCameraPermissionsAsync();
      setCameraStatus(mapStatus(r));
    }
  };

  const handleOpenSettings = () => {
    void Linking.openSettings();
  };

  const partialDenied = micStatus === 'denied' || cameraStatus === 'denied';

  return (
    <PageLayout
      footer={
        partialDenied ? (
          <PrimaryButton
            label="시스템 설정으로 이동"
            variant="secondary"
            size="lg"
            onPress={handleOpenSettings}
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        <View style={styles.heroArea}>
          <Text style={styles.hero}>권한이 필요해요</Text>
          <Text style={styles.gloss}>권한 필요</Text>
        </View>

        <View style={styles.list}>
          {cards.map((card) => {
            const status = card.key === 'mic' ? micStatus : cameraStatus;
            const isGranted = status === 'granted';
            const isDenied = status === 'denied';

            const cardStateStyle = isGranted
              ? card.tone === 'hearing'
                ? styles.cardGrantedHearing
                : styles.cardGrantedSigner
              : isDenied
                ? styles.cardDenied
                : styles.cardDefault;

            const markStyle = isGranted
              ? card.tone === 'hearing'
                ? styles.markGrantedHearing
                : styles.markGrantedSigner
              : isDenied
                ? styles.markDenied
                : styles.markUnknown;

            const mark = isGranted ? '✓' : '✕';

            return (
              <Pressable
                key={card.key}
                onPress={() => void handleCardTap(card.key)}
                disabled={isGranted}
                style={({ pressed }) => [
                  styles.card,
                  cardStateStyle,
                  pressed && !isGranted && styles.cardPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${card.label} ${
                  isGranted ? '허용됨' : isDenied ? '거부됨' : '허용해주세요'
                }`}
              >
                <Text style={styles.icon}>{card.icon}</Text>
                <View style={styles.cardText}>
                  <Text style={styles.cardLabel}>{card.label}</Text>
                  <Text style={styles.cardDetailPlain}>{card.detailPlain}</Text>
                  <Text style={styles.cardDetailGloss}>{card.detailGloss}</Text>
                </View>
                <Text style={[styles.mark, markStyle]}>{mark}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PageLayout>
  );
};

const ICON_FONT_SIZE = 36;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing[8],
  },
  heroArea: {
    paddingTop: spacing[6],
    gap: spacing[2],
  },
  hero: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['4xl'],
    lineHeight: lineHeight['4xl'],
    color: colors.text.primary,
  },
  gloss: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    color: colors.text.secondary,
  },
  list: {
    gap: spacing[3],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[5],
  },
  cardDefault: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.default,
  },
  cardGrantedHearing: {
    backgroundColor: colors.hearing.bg,
    borderColor: colors.hearing.border,
  },
  cardGrantedSigner: {
    backgroundColor: colors.signer.bg,
    borderColor: colors.signer.border,
  },
  cardDenied: {
    backgroundColor: colors.status.error.bg,
    borderColor: colors.status.error.border,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
  },
  icon: {
    fontSize: ICON_FONT_SIZE,
  },
  cardText: {
    flex: 1,
    gap: spacing[1],
  },
  cardLabel: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
  },
  cardDetailPlain: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: colors.text.secondary,
  },
  cardDetailGloss: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: colors.text.muted,
  },
  mark: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.xl,
  },
  markUnknown: {
    color: colors.text.muted,
  },
  markGrantedHearing: {
    color: colors.hearing.focusRing,
  },
  markGrantedSigner: {
    color: colors.signer.focusRing,
  },
  markDenied: {
    color: colors.status.error.text,
  },
});
