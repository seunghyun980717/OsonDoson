import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AvatarThreeRenderer } from '@/components/AvatarThreeRenderer';
import { AvatarVideoPlayer } from '@/components/AvatarVideoPlayer';
import { GlossPill } from '@/components/GlossPill';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RoleHeader } from '@/components/RoleHeader';
import { fetchMockSpeechToSign } from '@/dev/mock-data';
import { useFlow } from '@/hooks/useFlow';
import { useHaptic } from '@/hooks/useHaptic';
import type { ViewerFrame } from '@/lib/avatar-renderer/avatarTypes';
import { normalizeAvatarPayload } from '@/lib/avatar-renderer/normalizeAvatarPayload';
import { spacing } from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

// 다시 재생과 닫기는 헤더로 이전 — 본문은 아바타와 글로스 칩으로만 구성.
// 푸터는 농인이 이어서 수어로 답한다는 다음 행동을 그대로 명시. 색은 현재 holder 톤(peach)에 맞춤.
// 평문(korean)은 농인 가독성 톤과 안 맞아 노출하지 않는다 (jetson SignerResultScreen 미러).
// replayNonce는 AvatarVideoPlayer로 전달돼 처음부터 재생 트리거.
type Navigation = NativeStackNavigationProp<RootStackParamList, 'Flow'>;

export const SignerResultScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { dispatch, lastSpeechToSign, setLastSpeechToSign } = useFlow();
  const haptic = useHaptic();
  const [replayNonce, setReplayNonce] = useState(0);
  const [readyKeypointSequence, setReadyKeypointSequence] = useState<readonly ViewerFrame[] | undefined>(undefined);

  useEffect(() => {
    if (lastSpeechToSign) return;
    if (!__DEV__) return;
    let cancelled = false;
    fetchMockSpeechToSign(0).then((r) => {
      if (cancelled) return;
      setLastSpeechToSign(r);
    });
    return () => {
      cancelled = true;
    };
  }, [lastSpeechToSign, setLastSpeechToSign]);

  const handleReplay = () => {
    haptic.medium();
    setReplayNonce((n) => n + 1);
    dispatch({ type: 'REPLAY' });
  };

  const handleHome = () => {
    navigation.replace('Main');
  };

  const handleNext = () => {
    haptic.medium();
    dispatch({ type: 'NEXT_TURN' });
  };
  const avatarPayload = useMemo(
    () => normalizeAvatarPayload(lastSpeechToSign?.keypoint_payload),
    [lastSpeechToSign?.keypoint_payload],
  );
  const avatarFrames = avatarPayload.frames;
  const canPlayAvatar = avatarFrames !== undefined && readyKeypointSequence === avatarFrames;
  const handleAvatarReady = useCallback(() => {
    setReadyKeypointSequence(avatarFrames);
  }, [avatarFrames]);

  return (
    <PageLayout
      header={
        <RoleHeader role="signer" onClose={handleHome} onReplay={handleReplay} />
      }
      footer={
        <PrimaryButton
          label="수어 입력하기"
          variant="signer"
          size="lg"
          onPress={handleNext}
        />
      }
    >
      <View style={styles.body}>
        <View style={styles.avatarStage}>
          <AvatarVideoPlayer
            keypointSequence={avatarFrames}
            replayNonce={replayNonce}
            fps={avatarPayload.fps}
            canPlay={canPlayAvatar}
            renderFrame={(frame, currentFrameIndex) => (
              <AvatarThreeRenderer
                frame={frame as ViewerFrame}
                frameIndex={currentFrameIndex}
                frames={avatarFrames}
                onReady={handleAvatarReady}
              />
            )}
          />
        </View>

        {(lastSpeechToSign?.glosses ?? []).length > 0 && (
          <View style={styles.glossList}>
            {(lastSpeechToSign?.glosses ?? []).map((gloss, i) => (
              <GlossPill key={`${gloss}-${i}`} label={gloss} tone="signer" />
            ))}
          </View>
        )}
      </View>
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing[4],
  },
  glossList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  // AvatarVideoPlayer가 자체 placeholder(흰 surface + peach 점선)를 가짐.
  // 화면 가로폭 기준 1:1 정사각으로 고정 (글로스 문장이 잘리지 않도록 본문 상단 고정 영역).
  avatarStage: {
    alignSelf: 'stretch',
    aspectRatio: 1,
  },
});
