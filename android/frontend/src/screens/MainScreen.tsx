import { DrawerActions, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { HapticToggle } from '@/components/HapticToggle';
import { MenuIcon } from '@/components/MenuIcon';
import { PageLayout } from '@/components/PageLayout';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useHaptic } from '@/hooks/useHaptic';
import {
  colors,
  fontFamily,
  fontSize,
  lineHeight,
  spacing,
} from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Main'>;

export const MainScreen = () => {
  const navigation = useNavigation<Navigation>();
  const haptic = useHaptic();

  const startHearing = () => {
    haptic.medium();
    navigation.navigate('Flow', { entry: 'hearing' });
  };

  const startSigner = () => {
    haptic.medium();
    navigation.navigate('Flow', { entry: 'signer' });
  };

  const handleOpenDrawer = () =>
    navigation.dispatch(DrawerActions.openDrawer());

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
    >
      <View style={styles.body}>
        <View style={styles.heroArea}>
          <Text style={styles.hero}>{'대화를 시작할까요?'}</Text>
        </View>
        <View style={styles.actions}>
          <PrimaryButton
            label="말하면서 대화"
            variant="hearing"
            size="xl"
            onPress={startHearing}
          />
          <PrimaryButton
            label="수어로 대화"
            variant="signer"
            size="xl"
            onPress={startSigner}
          />
        </View>
      </View>
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
    flex: 1,
    justifyContent: 'center',
    gap: spacing[10],
  },
  heroArea: {
    alignItems: 'flex-start',
  },
  hero: {
    fontFamily: fontFamily.pretendardSemibold,
    fontSize: fontSize['4xl'],
    lineHeight: lineHeight['4xl'],
    color: colors.text.primary,
  },
  actions: {
    gap: spacing[3],
  },
});
