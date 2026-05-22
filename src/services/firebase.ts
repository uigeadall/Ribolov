// Firebase auth persistence wants the full AsyncStorageStatic interface
// (mergeItem, multiSet, multiMerge, flushGetRequests). Our MMKV shim only
// covers the subset we use elsewhere — auth keeps the real module here.
// Auth tokens are written rarely (login / refresh) so the perf delta vs MMKV
// is invisible; what matters is matching the persistence contract Firebase
// expects so token round-trips work.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFirebaseWebConfig, isFirebaseConfigured } from './firebaseConfig';

export type FirebaseBundle = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
};

function authForApp(app: FirebaseApp): Auth {
  // Web build of firebase/auth does NOT expose getReactNativePersistence and
  // doesn't need it — IndexedDB/localStorage is wired up automatically by
  // getAuth(). The RN-only path uses AsyncStorage so auth tokens survive
  // a process kill. This branch lets the same codebase bundle for both.
  if (Platform.OS === 'web') {
    return getAuth(app);
  }
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e: unknown) {
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
    if (code === 'auth/already-initialized') return getAuth(app);
    throw e;
  }
}

let bundle: FirebaseBundle | null = null;

export function ensureFirebase(): FirebaseBundle | null {
  if (!isFirebaseConfigured()) return null;
  const cfg = getFirebaseWebConfig();
  if (!cfg.apiKey || !cfg.projectId) return null;
  if (!bundle) {
    const existingApps = getApps();
    const app = existingApps.length ? existingApps[0]! : initializeApp(cfg);
    bundle = {
      app,
      auth: authForApp(app),
      // Memory cache is the only option for `firebase/firestore` on React Native:
      // `persistentLocalCache` requires IndexedDB, which RN doesn't provide, and
      // the SDK falls back to memory cache anyway while logging a noisy warning.
      // For real offline persistence we'd need `@react-native-firebase/firestore`
      // (native bridge, different API). Not done yet.
      db: initializeFirestore(app, { localCache: memoryLocalCache() }),
      storage: getStorage(app),
    };
  }
  return bundle;
}

export function requireFirebase(): FirebaseBundle {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е конфигуриран.');
  return fb;
}
