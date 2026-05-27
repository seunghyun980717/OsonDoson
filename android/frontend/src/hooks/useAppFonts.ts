import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

// Android RN은 OpenType variable font의 weight axis를 자동 분리하지 못해서
// 단일 PretendardVariable.ttf를 'Pretendard'로 등록하면 medium/semibold/bold가 시스템 글꼴로 폴백된다.
// weight별 정적 .otf를 따로 등록하고 사용처에서 fontFamily를 weight 이름까지 명시한다.
export function useAppFonts() {
  const [loaded, error] = useFonts({
    'Pretendard-Regular': require('pretendard/dist/public/static/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('pretendard/dist/public/static/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('pretendard/dist/public/static/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('pretendard/dist/public/static/Pretendard-Bold.otf'),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  return { loaded, error };
}
