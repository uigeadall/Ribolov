import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as Updates from 'expo-updates';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFonts, Nunito_400Regular, Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { StatusBar } from 'expo-status-bar';
import { SafeToast } from './src/components/SafeToast';
import { ActionSheetHost } from './src/components/ActionSheet';
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
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { parseInviteUrl, storePendingReferrer } from './src/services/referral';

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
    // Deep-link handler for friend-invite URLs (ribolov-app://invite/<uid>).
    // Cold-start delivery comes via getInitialURL; warm resume comes via the
    // 'url' event. Both feed into the same storePendingReferrer call so the
    // attribution path stays single-source. The actual write to Firestore
    // happens later in authContext after onAuthStateChanged delivers the
    // signed-in user — splitting capture from redemption lets the link
    // arrive before, during, or after onboarding without losing it.
    Linking.getInitialURL()
      .then((url) => {
        const inviter = url ? parseInviteUrl(url) : null;
        if (inviter) void storePendingReferrer(inviter);
      })
      .catch(() => undefined);
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      const inviter = parseInviteUrl(url);
      if (inviter) void storePendingReferrer(inviter);
    });
    return () => {
      clearTimeout(t);
      urlSub.remove();
    };
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
          {/* Top-level boundary so any unhandled render crash anywhere in the
              tree gets reported to Sentry (via the ErrorBoundary's
              componentDidCatch) AND shown to the user as a fallback screen
              instead of a white screen + silent dead app. */}
          <ErrorBoundary label="app_root">
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
              <ActionSheetHost />
            </AuthProvider>
          </ErrorBoundary>
        </ThemeProvider>
        <OfflineBar />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
