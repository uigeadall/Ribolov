import React, { useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/services/themeContext';
import { AuthProvider } from './src/services/authContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initObservability } from './src/services/observability';
import { ensureFirebase } from './src/services/firebase';
import { initFirebaseAppCheckBridge } from './src/services/firebaseAppCheckBridge';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { OfflineBar } from './src/components/OfflineBar';
import AppSplashScreen from './src/components/AppSplashScreen';

const ONBOARDING_KEY = '@ribolov/onboarding_done';

const MIN_SPLASH_MS = 2200;

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold });
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    initObservability();
    const fb = ensureFirebase();
    if (fb) void initFirebaseAppCheckBridge(fb.app);
    AsyncStorage.getItem(ONBOARDING_KEY).then((v) => setOnboardingDone(v === '1'));
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  const handleOnboardingDone = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    setOnboardingDone(true);
  };

  if (onboardingDone === null || !fontsLoaded || !minTimeElapsed) return <AppSplashScreen />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            {onboardingDone ? (
              <>
                <RootNavigator />
                <StatusBar style="auto" />
              </>
            ) : (
              <OnboardingScreen onDone={handleOnboardingDone} />
            )}
            <Toast />
          </AuthProvider>
        </ThemeProvider>
        <OfflineBar />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
