import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { Camera } from 'expo-camera';
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { colors } from '@/lib/theme';
import { RootStackParamList } from '@/navigation/RootStack';

const SPLASH_DURATION_MS = 1000;

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Splash'>;

export const SplashScreen = () => {
  const navigation = useNavigation<Navigation>();

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    Promise.all([
      getRecordingPermissionsAsync(),
      Camera.getCameraPermissionsAsync(),
    ]).then(([mic, cam]) => {
      if (cancelled) return;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, SPLASH_DURATION_MS - elapsed);
      const allGranted = mic.granted && cam.granted;
      setTimeout(() => {
        if (cancelled) return;
        navigation.replace(allGranted ? 'Main' : 'Permission');
      }, remaining);
    });

    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.root}>
      <Image
        source={require('../../assets/logo_vertical.png')}
        style={styles.brand}
        resizeMode="contain"
        accessibilityLabel="오손도손"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.page,
  },
  brand: {
    width: 220,
    height: 220,
  },
});
