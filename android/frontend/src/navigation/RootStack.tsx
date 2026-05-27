import { NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { FlowEntry } from '@/contexts/flowMachine';
import { FlowContainer } from '@/screens/flow/FlowContainer';
import { PermissionScreen } from '@/screens/PermissionScreen';
import { SplashScreen } from '@/screens/SplashScreen';

import { HomeDrawer, HomeDrawerParamList } from './HomeDrawer';

export type RootStackParamList = {
  Splash: undefined;
  Permission: undefined;
  // 'Main'은 Drawer Navigator. 자식 화면(Translate/Recommend)으로 nested navigation 가능.
  // 기존 navigation.replace('Main') 호출처 그대로 — 진입 시 기본 자식 Translate 노출.
  Main: NavigatorScreenParams<HomeDrawerParamList> | undefined;
  Flow: { entry: FlowEntry };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootStack = () => (
  <Stack.Navigator
    initialRouteName="Splash"
    screenOptions={{ headerShown: false }}
  >
    <Stack.Screen name="Splash" component={SplashScreen} />
    <Stack.Screen name="Permission" component={PermissionScreen} />
    <Stack.Screen name="Main" component={HomeDrawer} />
    <Stack.Screen name="Flow" component={FlowContainer} />
  </Stack.Navigator>
);
