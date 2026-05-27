// 한손 수어 모집 — 감사 + 메인으로 이동.
// 메인 이동 시 OneHandSignStack을 Consent로 reset + Context 초기화 + Drawer를 Translate로.
// (다음에 메뉴 재진입 시 다시 Consent부터 시작하도록.)
import { DrawerActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlossPill } from '@/components/GlossPill';
import { MenuIcon } from '@/components/MenuIcon';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
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

type Navigation = NativeStackNavigationProp<OneHandSignStackParamList, 'ThankYou'>;

export const ThankYouScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();
  const { reset } = useOneHandSign();

  const handleOpenDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  const handleGoMain = () => {
    haptic.medium();
    reset();
    navigation.reset({ index: 0, routes: [{ name: 'Consent' }] });
    navigation.getParent()?.navigate('Translate' as never);
  };

  // 감사 화면에서 안드로이드 하드웨어 back은 의도적으로 차단. [메인으로] 버튼만 사용.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, []),
  );

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
          label="처음으로"
          variant="signer"
          size="lg"
          onPress={handleGoMain}
        />
      }
    >
      <View style={styles.body}>
        <View style={styles.heroIconWrap}>
          <Text style={styles.heroIcon}>💛</Text>
        </View>
        <Text style={styles.hero}>고마워요</Text>
        <View style={styles.glossWrap}>
          <GlossPill label="더 나은 / 오손도손 / 되다" tone="signer" size="sm" />
        </View>
      </View>
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[6],
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
  glossWrap: {
    alignSelf: 'center',
  },
});
