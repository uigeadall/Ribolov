import Constants from 'expo-constants';
import { Platform } from 'react-native';

type Extra = Record<string, unknown>;

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export type GoogleSignInClientIds = {
  webClientId: string;
  iosClientId: string;
  androidClientId: string;
};

/** OAuth 2.0 Client IDs от Google Cloud Console (Credentials), не Firebase apiKey. */
export function getGoogleSignInClientIds(): GoogleSignInClientIds {
  const e = extra();
  return {
    webClientId:
      trimStr(e.googleWebClientId) ||
      trimStr(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) ||
      '',
    iosClientId:
      trimStr(e.googleIosClientId) || trimStr(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) || '',
    androidClientId:
      trimStr(e.googleAndroidClientId) ||
      trimStr(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) ||
      '',
  };
}

/** Expo-auth-session изисква платформен client id (iOS/Android) или web за web. */
export function isGoogleSignInConfigured(): boolean {
  const { webClientId, iosClientId, androidClientId } = getGoogleSignInClientIds();
  if (Platform.OS === 'ios') return iosClientId.length > 12;
  if (Platform.OS === 'android') return androidClientId.length > 12;
  return webClientId.length > 12;
}

export function isFirebaseConfigured(): boolean {
  const e = extra();
  const key =
    (e.firebaseApiKey as string | undefined) ||
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
    '';
  return typeof key === 'string' && key.length > 8;
}

export function getFirebaseWebConfig() {
  const e = extra();
  return {
    apiKey:
      (e.firebaseApiKey as string) ||
      process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
      '',
    authDomain:
      (e.firebaseAuthDomain as string) ||
      process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      '',
    projectId:
      (e.firebaseProjectId as string) || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket:
      (e.firebaseStorageBucket as string) ||
      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      '',
    messagingSenderId:
      (e.firebaseMessagingSenderId as string) ||
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
      '',
    appId: (e.firebaseAppId as string) || process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
  };
}
