import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFirebaseWebConfig, isFirebaseConfigured } from './firebaseConfig';

export type FirebaseBundle = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
};

function authForApp(app: FirebaseApp): Auth {
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
      db: getFirestore(app),
      storage: getStorage(app),
    };
  }
  return bundle;
}
