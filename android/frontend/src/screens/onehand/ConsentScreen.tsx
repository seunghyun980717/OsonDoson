// 한손 수어 모집 — 안내 + 동의하고 시작.
// 헤더는 MainScreen 톤(햄버거 + 앱명), 액션은 signer 톤.
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MenuIcon } from '@/components/MenuIcon';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useHaptic } from '@/hooks/useHaptic';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  spacing,
} from '@/lib/theme';
import { OneHandSignStackParamList } from '@/navigation/OneHandSignStack';

type Navigation = NativeStackNavigationProp<OneHandSignStackParamList, 'Consent'>;

export const ConsentScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();

  const handleOpenDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  const handleStart = () => {
    haptic.medium();
    navigation.navigate('Record');
  };

  return (
    <PageLayout
      header={
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleOpenDrawer}
            accessibilityRole="button"
            accessibilityLabel="메뉴 열기"
            hitSlop={8}
          >
            <MenuIcon />
          </Pressable>
          <Image
            source={require('../../../assets/logo_horizontal.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="오손도손"
          />
        </View>
      }
      footer={
        <PrimaryButton
          label="동의하고 시작"
          variant="signer"
          size="lg"
          onPress={handleStart}
        />
      }
    >
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIconWrap}>
          <Text style={styles.heroIcon}>🤝</Text>
        </View>
        <Text style={styles.hero}>한손 수어 함께 모으기</Text>

        <View style={styles.paragraphs}>
          <Text style={styles.paragraph}>오손도손 / 한손 수어 / 부족</Text>
          <Text style={styles.paragraph}>보내다 / 학습 / 돕다</Text>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>모으는 내용</Text>
          <Text style={styles.noticeItem}>· 손 움직임 / 좌표</Text>
          <Text style={styles.noticeItem}>· 수어 단어 / 뜻</Text>
        </View>
      </ScrollView>
    </PageLayout>
  );
};

const HERO_ICON_SIZE = 96;

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[2],
  },
  logo: {
    height: 28,
    width: 120,
  },
  body: {
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
    gap: spacing[5],
  },
  heroIconWrap: {
    width: HERO_ICON_SIZE,
    height: HERO_ICON_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.signer.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIcon: {
    fontSize: 48,
  },
  hero: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize['3xl'],
    lineHeight: lineHeight['3xl'],
    color: colors.text.primary,
    textAlign: 'center',
  },
  paragraphs: {
    alignItems: 'center',
    gap: spacing[2],
  },
  paragraph: {
    fontFamily: fontFamily.pretendardMedium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    color: colors.text.primary,
    textAlign: 'center',
  },
  notice: {
    alignSelf: 'stretch',
    marginTop: spacing[2],
    padding: spacing[5],
    borderRadius: radius.xl,
    backgroundColor: colors.signer.bg,
    gap: spacing[2],
  },
  noticeTitle: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize.lg,
    color: colors.text.primary,
    marginBottom: spacing[1],
  },
  noticeItem: {
    fontFamily: fontFamily.pretendard,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: colors.text.primary,
  },
});
