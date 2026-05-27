// Home Drawer Navigator — Translate(역할 선택) / Recommend(글로스 추천 조합) / OneHandSign(한손 수어 모이기).
// RootStack의 'Main' route에 마운트. 기본 자식은 Translate.
import { createDrawerNavigator } from '@react-navigation/drawer';

import { MainScreen } from '@/screens/MainScreen';
import { RecommendScreen } from '@/screens/RecommendScreen';

import { colors, fontFamily, fontSize } from '@/lib/theme';

import { OneHandSignStack } from './OneHandSignStack';

export type HomeDrawerParamList = {
  Translate: undefined;
  Recommend: undefined;
  OneHandSign: undefined;
};

const Drawer = createDrawerNavigator<HomeDrawerParamList>();

export const HomeDrawer = () => (
  <Drawer.Navigator
    initialRouteName="Translate"
    screenOptions={{
      headerShown: false,
      drawerStyle: { backgroundColor: colors.surface.page },
      drawerActiveTintColor: colors.text.primary,
      drawerInactiveTintColor: colors.text.secondary,
      drawerActiveBackgroundColor: colors.hearing.bg,
      drawerLabelStyle: {
        fontFamily: fontFamily.pretendardSemibold,
        fontSize: fontSize.xl,
      },
    }}
  >
    <Drawer.Screen name="Translate" component={MainScreen} options={{ title: '번역' }} />
    <Drawer.Screen name="Recommend" component={RecommendScreen} options={{ title: '추천' }} />
    <Drawer.Screen
      name="OneHandSign"
      component={OneHandSignStack}
      options={{ title: '한손 수어 모으기' }}
    />
  </Drawer.Navigator>
);
