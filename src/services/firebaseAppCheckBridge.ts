/**
 * Мост: React Native Firebase App Check → Firebase JS SDK (Firestore/Auth от firebase package).
 * Включва се само при firebaseAppCheckEnabled в extra или EXPO_PUBLIC_FIREBASE_APP_CHECK=1.
 * В Firebase Console: включи Device Check / Play Integrity (или debug токени при разработка).
 * За Firestore enforcement: App Check → услуги → Firestore.
 */
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import { isFirebaseConfigured } from './firebaseConfig';
import { addBreadcrumb, captureException } from './observability';

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function isAppCheckBridgeEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as typeof import('expo-constants').default;
    const e = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    if (trimStr(e.firebaseAppCheckEnabled).toLowerCase() === 'true') return true;
    return trimStr(process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK) === '1';
  } catch {
    return trimStr(process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK) === '1';
  }
}

function debugToken(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as typeof import('expo-constants').default;
    const e = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    const t = trimStr(e.firebaseAppCheckDebugToken) || trimStr(process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN);
    return t || undefined;
  } catch {
    const t = trimStr(process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN);
    return t || undefined;
  }
}

let jsAppCheckInit = false;

export async function initFirebaseAppCheckBridge(jsApp: FirebaseApp): Promise<void> {
  if (!isFirebaseConfigured() || !isAppCheckBridgeEnabled() || jsAppCheckInit) return;

  if (__DEV__ && !debugToken()) {
    addBreadcrumb('firebase', 'app_check_skipped_dev_needs_debug_token');
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getApp } = require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnfbModular = require('@react-native-firebase/app-check/dist/module/modular.js') as {
      initializeAppCheck: (app: ReturnType<typeof getApp>, options: Record<string, unknown>) => Promise<unknown>;
      getToken: (appCheckInstance: unknown, forceRefresh?: boolean) => Promise<{ token: string }>;
      ReactNativeFirebaseAppCheckProvider: new () => {
        configure: (o: Record<string, unknown>) => void;
      };
    };

    const nativeApp = getApp();
    const RNProviderCtor = rnfbModular.ReactNativeFirebaseAppCheckProvider;
    const rnProviderInstance = new RNProviderCtor();
    const dbg = debugToken();
    rnProviderInstance.configure({
      android: {
        provider: __DEV__ ? 'debug' : 'playIntegrity',
        ...(dbg ? { debugToken: dbg } : {}),
      },
      apple: {
        provider: __DEV__ ? 'debug' : 'deviceCheck',
        ...(dbg ? { debugToken: dbg } : {}),
      },
    });

    const nativeAc = await rnfbModular.initializeAppCheck(nativeApp, {
      provider: rnProviderInstance,
      isTokenAutoRefreshEnabled: true,
    });

    initializeAppCheck(jsApp, {
      provider: new CustomProvider({
        getToken: async () => {
          const r = await rnfbModular.getToken(nativeAc, false);
          return {
            token: r.token,
            expireTimeMillis: Date.now() + 50 * 60 * 1000,
          };
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });

    jsAppCheckInit = true;
    addBreadcrumb('firebase', 'app_check_bridge_ok');
  } catch (e) {
    captureException(e, { area: 'firebase_app_check_bridge' });
  }
}
