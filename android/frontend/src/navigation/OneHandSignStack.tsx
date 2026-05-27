// 한손 수어 데이터 모집 — Drawer.Screen 안에서 마운트되는 nested Stack.
// 5개 화면(Consent → Record → Playback → GlossInput → ThankYou)을 push/pop으로 흘림.
// OneHandSignProvider가 5개 화면 공통으로 frames/videoUri/gloss/status를 보관.
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OneHandSignProvider } from '@/contexts/OneHandSignProvider';
import { ConsentScreen } from '@/screens/onehand/ConsentScreen';
import { GlossInputScreen } from '@/screens/onehand/GlossInputScreen';
import { PlaybackScreen } from '@/screens/onehand/PlaybackScreen';
import { RecordScreen } from '@/screens/onehand/RecordScreen';
import { ThankYouScreen } from '@/screens/onehand/ThankYouScreen';

export type OneHandSignStackParamList = {
  Consent: undefined;
  Record: undefined;
  Playback: undefined;
  GlossInput: undefined;
  ThankYou: undefined;
};

const Stack = createNativeStackNavigator<OneHandSignStackParamList>();

export const OneHandSignStack = () => (
  <OneHandSignProvider>
    <Stack.Navigator
      initialRouteName="Consent"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Consent" component={ConsentScreen} />
      <Stack.Screen name="Record" component={RecordScreen} />
      <Stack.Screen name="Playback" component={PlaybackScreen} />
      <Stack.Screen name="GlossInput" component={GlossInputScreen} />
      <Stack.Screen name="ThankYou" component={ThankYouScreen} />
    </Stack.Navigator>
  </OneHandSignProvider>
);
