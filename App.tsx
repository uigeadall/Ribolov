import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/services/themeContext';
import { AuthProvider } from './src/services/authContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initObservability } from './src/services/observability';
import { ensureFirebase } from './src/services/firebase';
import { initFirebaseAppCheckBridge } from './src/services/firebaseAppCheckBridge';

export default function App() {
  useEffect(() => {
    initObservability();
    const fb = ensureFirebase();
    if (fb) void initFirebaseAppCheckBridge(fb.app);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
