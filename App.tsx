import React, { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFonts, Nunito_400Regular, Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { StatusBar } from 'expo-status-bar';
import { SafeToast } from './src/components/SafeToast';
import AsyncStorage, { migrateFromAsyncStorageIfNeeded } from './src/storage/kv';
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

const MIN_SPLASH_MS = 3500;

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [fontsLoaded] = useFonts({ Nunito_400Regular, Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold });
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    initObservability();
    const fb = ensureFirebase();
    if (fb) void initFirebaseAppCheckBridge(fb.app);
    // One-shot AsyncStorage → MMKV migration. Runs before any other storage
    // read so subsequent calls hit the new backend. The migration sets its own
    // sentinel; subsequent launches return immediately.
    (async () => {
      await migrateFromAsyncStorageIfNeeded();
      const v = await AsyncStorage.getItem(ONBOARDING_KEY);
      setOnboardingDone(v === '1');
    })();
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS);
    if (!__DEV__) {
      Updates.checkForUpdateAsync()
        .then(({ isAvailable }) => { if (isAvailable) return Updates.fetchUpdateAsync(); })
        .then((res) => { if (res) void Updates.reloadAsync(); })
        .catch(() => {});
    }
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
            <SafeToast />
          </AuthProvider>
        </ThemeProvider>
        <OfflineBar />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
