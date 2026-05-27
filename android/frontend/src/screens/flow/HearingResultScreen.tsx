import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { fetchMockSignToSpeech } from '@/dev/mock-data';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import { absoluteAudioUrl } from '@/lib/api/translation';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
} from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

// 다시 재생과 닫기는 헤더로 이전 — 본문은 평문(korean) 한 덩어리만 남긴다.
// 청인 holder 화면이라 평문 노출은 유지(글로스 X). 푸터는 다음 행동만 단일 버튼.
// 음성은 진입 시 자동 1회 재생, 헤더 ▶ 칩으로 처음부터 다시 재생.
type Navigation = NativeStackNavigationProp<RootStackParamList, 'Flow'>;

export const HearingResultScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { dispatch, lastSignToSpeech, setLastSignToSpeech } = useFlow();
  const haptic = useHaptic();

  useEffect(() => {
    if (lastSignToSpeech) return;
    if (!__DEV__) return;
    let cancelled = false;
    fetchMockSignToSpeech(0).then((r) => {
      if (cancelled) return;
      setLastSignToSpeech(r);
    });
    return () => {
      cancelled = true;
    };
  }, [lastSignToSpeech, setLastSignToSpeech]);

  const audioPath = lastSignToSpeech?.audio_url ?? null;
  const audioUri = audioPath ? absoluteAudioUrl(audioPath) : null;
  const player = useAudioPlayer(audioUri);

  useEffect(() => {
    if (!audioUri) return;
    player.play();
  }, [audioUri, player]);

  const handlePlay = async () => {
    if (!audioUri) return;
    haptic.medium();
    await player.seekTo(0);
    player.play();
  };

  const handleHome = () => {
    navigation.replace('Main');
  };

  const handleNext = () => {
    haptic.medium();
    dispatch({ type: 'NEXT_TURN' });
  };

  const playEnabled = audioUri !== null;

  return (
    <PageLayout
      header={
        <RoleHeader
          role="hearing"
          onClose={handleHome}
          onReplay={playEnabled ? handlePlay : undefined}
        />
      }
      footer={
        <PrimaryButton
          label="음성 입력하기"
          variant="hearing"
          size="lg"
          onPress={handleNext}
        />
      }
    >
      <View style={styles.body}>
        <Text style={styles.korean}>{lastSignToSpeech?.korean ?? ''}</Text>
      </View>
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  korean: {
    fontFamily: fontFamily.pretendardBold,
    fontSize: fontSize['3xl'],
    lineHeight: lineHeight['3xl'],
    color: colors.text.primary,
    textAlign: 'center',
  },
});
