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

const ONBOARDED_KEY = '@ribolov/onboarded';

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold });

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    initObservability();
    const fb = ensureFirebase();
    if (fb) void initFirebaseAppCheckBridge(fb.app);
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));
  }, []);

  const handleOnboardingDone = async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
    setOnboarded(true);
  };

  // Still loading the onboarding flag or fonts — render nothing to avoid flash
  if (onboarded === null || !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            {onboarded ? (
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
