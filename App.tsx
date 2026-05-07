import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
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

const ONBOARDED_KEY = '@ribolov/onboarded';

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    initObservability();
    const fb = ensureFirebase();
    if (fb) void initFirebaseAppCheckBridge(fb.app);
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));
  }, []);

  const handleOnboardingDone = async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
    setOnboarded(true);
  };

  // Still loading the onboarding flag — render nothing to avoid flash
  if (onboarded === null) return null;

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
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
