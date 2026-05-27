// 추천 화면 — 농인이 카테고리 + 글로스 시퀀스 조합 → 청인에게 TTS 전달.
// 농인 holder 화면이라 안내 카피·라벨은 글로스 톤. 행동 명령형 짧은 라벨은 평문 OK.
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useAudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HapticToggle } from '@/components/HapticToggle';
import { MenuIcon } from '@/components/MenuIcon';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  fetchMockGlossesToSpeech,
  fetchMockRecommendations,
  recommendCategories,
} from '@/dev/mock-data';
import { useHaptic } from '@/hooks/useHaptic';
import {
  absoluteAudioUrl,
  fetchRecommendCategories,
  glossesToSpeech,
  recommendGlosses,
} from '@/lib/api/translation';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';

const FETCH_DEBOUNCE_MS = 200;

// 섹션 헤더 — 좌측 컬러 strip + 라벨. 글로스 톤 라벨이 글자만이라
// 시각적으로 안 들어오는 문제를 strip 으로 보완.
const SectionHeader = ({ label }: { label: string }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionAccent} />
    <Text style={styles.sectionLabel}>{label}</Text>
  </View>
);

// 카테고리 무관 공통 끝맺음 표현. KSL 의문문은 보통 의문사가 문장 끝에 오고,
// 판정 의문문은 맞다/가능/있다/없다 류로 종결.
const QUESTION_WORDS: readonly string[] = [
  '무엇',
  '어디',
  '언제',
  '누구',
  '왜',
  '어떻게',
  '얼마',
];
const SENTENCE_ENDERS: readonly string[] = ['맞다', '가능', '있다', '없다'];

export const RecommendScreen = () => {
  const navigation = useNavigation();
  const haptic = useHaptic();
  const [category, setCategory] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // 카테고리 목록 — BE `/api/glosses/categories` 응답으로 갱신. 실패 시 mock fallback (초기값).
  const [categories, setCategories] = useState<readonly string[]>(recommendCategories);

  // mount 시 1회 BE 카테고리 fetch. 실패하면 초기값(mock) 그대로 유지.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchRecommendCategories();
        if (cancelled) return;
        if (result.categories && result.categories.length > 0) {
          setCategories(result.categories);
        }
      } catch {
        // BE 안 닿거나 endpoint 미배포 시 — fallback 유지
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 빈 player로 시작 — handleSpeak에서 replace + play 호출 (동일 URL 재호출 대응)
  const player = useAudioPlayer();

  const handleOpenDrawer = () =>
    navigation.dispatch(DrawerActions.openDrawer());

  const handleSelectCategory = (next: string) => {
    setCategory(next);
    setSequence([]); // spec §11-6 11-C — 카테고리 변경 시 시퀀스 초기화
  };

  const handleAddGloss = (gloss: string) => {
    setSequence((prev) => [...prev, gloss]);
  };

  const handleRemoveGloss = (idx: number) => {
    setSequence((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleReset = () => setSequence([]);

  // 카테고리 / 시퀀스 변경 시 자동 후보 fetch (debounce). 실패 시 mock fallback.
  useEffect(() => {
    if (!category) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let next: string[];
      try {
        const result = await recommendGlosses(category, sequence);
        next = result.recommendations;
      } catch {
        next = await fetchMockRecommendations(category, sequence);
      }
      if (!cancelled) setCandidates(next);
    }, FETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, sequence]);

  const handleSpeak = async () => {
    if (sequence.length === 0 || isSpeaking) return;
    haptic.medium();
    setIsSpeaking(true);
    try {
      let audioUrl: string | null | undefined;
      try {
        const result = await glossesToSpeech(sequence);
        audioUrl = result.audio_url;
      } catch {
        const result = await fetchMockGlossesToSpeech(sequence);
        audioUrl = result.audio_url;
      }
      if (audioUrl) {
        player.replace({ uri: absoluteAudioUrl(audioUrl) });
        await player.seekTo(0);
        player.play();
      }
    } finally {
      setIsSpeaking(false);
    }
  };

  const canSpeak = sequence.length > 0 && !isSpeaking;

  return (
    <PageLayout
      header={
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={handleOpenDrawer}
              accessibilityRole="button"
              accessibilityLabel="메뉴 열기"
              hitSlop={8}
            >
              <MenuIcon />
            </Pressable>
            <Image
              source={require('../../assets/logo_horizontal.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="오손도손"
            />
          </View>
          <HapticToggle />
        </View>
      }
      footer={
        <View style={styles.footer}>
          <View style={styles.footerSlot}>
            <PrimaryButton
              label="초기화"
              variant="secondary"
              size="lg"
              onPress={handleReset}
            />
          </View>
          <View style={styles.footerSlot}>
            <PrimaryButton
              label={isSpeaking ? '들려주는 중…' : '음성 듣기'}
              variant="signer"
              size="lg"
              onPress={handleSpeak}
              disabled={!canSpeak}
            />
          </View>
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.body}>
        {/* 카테고리 영역 */}
        <View style={styles.section}>
          <SectionHeader label="상황 / 고름" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            {categories.map((cat) => {
              const selected = cat === category;
              return (
                <Pressable
                  key={cat}
                  onPress={() => handleSelectCategory(cat)}
                  style={({ pressed }) => [
                    styles.categoryChip,
                    selected && styles.categoryChipSelected,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryChipLabel,
                      selected && styles.categoryChipLabelSelected,
                    ]}
                  >
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* 시퀀스 영역 */}
        <View style={styles.section}>
          <SectionHeader label="지금 / 표현" />
          {sequence.length === 0 ? (
            <Text style={styles.empty}>
              {category ? '후보 / 고름' : '상황 / 먼저 고름'}
            </Text>
          ) : (
            <View style={styles.pillWrap}>
              {sequence.map((gloss, i) => (
                <Pressable
                  key={`${gloss}-${i}`}
                  onPress={() => handleRemoveGloss(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${gloss} 빼기`}
                  style={({ pressed }) => [
                    styles.sequencePill,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={styles.sequencePillLabel}>{gloss}</Text>
                  <Text style={styles.sequencePillRemove}>✕</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* 후보 영역 */}
        <View style={styles.section}>
          <SectionHeader label="다음 / 후보" />
          {!category ? (
            <Text style={styles.empty}>{'상황 / 먼저 고름'}</Text>
          ) : candidates.length === 0 ? (
            <Text style={styles.empty}>{'후보 없음'}</Text>
          ) : (
            <View style={styles.pillWrap}>
              {candidates.map((gloss) => (
                <Pressable
                  key={gloss}
                  onPress={() => handleAddGloss(gloss)}
                  accessibilityRole="button"
                  accessibilityLabel={`${gloss} 더하기`}
                  style={({ pressed }) => [
                    styles.candidatePill,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={styles.candidatePillLabel}>{gloss}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* 끝맺음 영역 — 카테고리 무관 공통 표현 (의문사 + 마침) */}
        <View style={styles.section}>
          <SectionHeader label="끝맺음 / 의문" />

          {/* 의문사 그룹 — KSL 의문사는 보통 문장 끝에 옴 */}
          <Text style={styles.subgroupLabel}>{'의문사'}</Text>
          <View style={styles.pillWrap}>
            {QUESTION_WORDS.map((gloss) => (
              <Pressable
                key={`wh-${gloss}`}
                onPress={() => handleAddGloss(gloss)}
                accessibilityRole="button"
                accessibilityLabel={`${gloss} 더하기`}
                style={({ pressed }) => [
                  styles.candidatePill,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text style={styles.candidatePillLabel}>{gloss}</Text>
              </Pressable>
            ))}
          </View>

          {/* 마침 그룹 — 판정 의문문 글로스 + 시각 부호 */}
          <Text style={styles.subgroupLabel}>{'마침'}</Text>
          <View style={styles.pillWrap}>
            {SENTENCE_ENDERS.map((gloss) => (
              <Pressable
                key={`end-${gloss}`}
                onPress={() => handleAddGloss(gloss)}
                accessibilityRole="button"
                accessibilityLabel={`${gloss} 더하기`}
                style={({ pressed }) => [
                  styles.candidatePill,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text style={styles.candidatePillLabel}>{gloss}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </PageLayout>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  logo: {
    height: 28,
    width: 120,
  },
  body: {
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    gap: spacing[6],
  },
  section: {
    gap: spacing[3],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  sectionAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.signer.action,
  },
  sectionLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    color: colors.text.primary,
  },
  subgroupLabel: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing[2],
  },
  empty: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    color: colors.text.muted,
  },
  categoryRow: {
    gap: spacing[1],
    paddingRight: spacing[4],
  },
  categoryChip: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  categoryChipSelected: {
    backgroundColor: colors.signer.action,
    borderColor: colors.signer.action,
  },
  categoryChipLabel: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  categoryChipLabelSelected: {
    fontFamily: fontFamily.pretendardMedium,
    color: colors.signer.actionFg,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  sequencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    backgroundColor: colors.signer.bg,
    borderWidth: 1,
    borderColor: colors.signer.border,
  },
  sequencePillLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.base,
    color: colors.signer.focusRing,
  },
  sequencePillRemove: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.sm,
    color: colors.text.muted,
  },
  candidatePill: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.signer.border,
    backgroundColor: colors.surface.card,
  },
  candidatePillLabel: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.base,
    color: colors.text.primary,
  },
  chipPressed: {
    transform: [{ scale: 0.96 }],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  footerSlot: {
    flex: 1,
  },
});
