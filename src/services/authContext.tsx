import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  signInWithCredential,
  updateProfile,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { ensureFirebase } from './firebase';
import { isFirebaseConfigured } from './firebaseConfig';
import { deleteAllUserCloudData, updateUserPresence } from './cloudSync';
import { wipeAllLocalAppData } from '../storage/storage';
import { clearCatchSyncQueue, flushPendingCatchSync } from './catchSyncQueue';
import { flushPendingMessages } from './messageSyncQueue';
import { registerForPushNotifications } from './pushNotifications';
import { restoreAchievementsFromCloud } from './achievements';

export type AuthContextValue = {
  user: User | null;
  configured: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithApple: (idToken: string, rawNonce: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

const LAST_UID_KEY = '@ribolov/lastUid';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const fb = ensureFirebase();
      const u = fb?.auth.currentUser;
      if (next === 'active') {
        if (u) {
          void flushPendingCatchSync({
            user: { uid: u.uid, displayName: u.displayName, email: u.email },
          });
          void flushPendingMessages();
          void updateUserPresence(u.uid, true);
        }
      } else if (next === 'background' || next === 'inactive') {
        if (u) void updateUserPresence(u.uid, false);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const fb = ensureFirebase();
    if (!fb) {
      setUser(null);
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(fb.auth, (u) => {
      void (async () => {
        if (u) {
          const lastUid = await AsyncStorage.getItem(LAST_UID_KEY).catch(() => null);
          if (lastUid !== null && lastUid !== u.uid) {
            // Different user signed in — clear the previous user's local data
            await wipeAllLocalAppData().catch(() => undefined);
            await clearCatchSyncQueue().catch(() => undefined);
          }
          await AsyncStorage.setItem(LAST_UID_KEY, u.uid).catch(() => undefined);
          flushPendingCatchSync({
            user: { uid: u.uid, displayName: u.displayName, email: u.email },
          }).catch(() => undefined);
          flushPendingMessages().catch(() => undefined);
          registerForPushNotifications(u.uid).catch(() => undefined);
          restoreAchievementsFromCloud(u.uid).catch(() => undefined);
          updateUserPresence(u.uid, true).catch(() => undefined);
        } else {
          await AsyncStorage.removeItem(LAST_UID_KEY).catch(() => undefined);
        }
        setUser(u);
        setLoading(false);
      })();
    });
    return unsub;
  }, [configured]);

  const signIn = useCallback(async (email: string, password: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    await signInWithEmailAndPassword(fb.auth, email.trim(), password);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    const cred = await createUserWithEmailAndPassword(fb.auth, email.trim(), password);
    const name = displayName?.trim();
    if (name) await updateProfile(cred.user, { displayName: name });
  }, []);

  const signInWithGoogleIdToken = useCallback(async (idToken: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    const token = idToken.trim();
    if (!token) throw new Error('Липсва Google ID token.');
    const cred = GoogleAuthProvider.credential(token);
    await signInWithCredential(fb.auth, cred);
  }, []);

  const signInWithApple = useCallback(async (idToken: string, rawNonce: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    const token = idToken.trim();
    if (!token) throw new Error('Липсва Apple identity token.');
    const nonce = rawNonce.trim();
    if (!nonce) throw new Error('Липсва Apple nonce.');
    const apple = new OAuthProvider('apple.com');
    const cred = apple.credential({ idToken: token, rawNonce: nonce });
    await signInWithCredential(fb.auth, cred);
  }, []);

  const signOut = useCallback(async () => {
    const fb = ensureFirebase();
    const u = fb?.auth.currentUser;
    if (u) await updateUserPresence(u.uid, false).catch(() => undefined);
    await wipeAllLocalAppData().catch(() => undefined);
    await clearCatchSyncQueue().catch(() => undefined);
    await AsyncStorage.removeItem(LAST_UID_KEY).catch(() => undefined);
    if (fb) await firebaseSignOut(fb.auth);
    else setUser(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    await sendPasswordResetEmail(fb.auth, email.trim());
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    const fb = ensureFirebase();
    const u = fb?.auth.currentUser;
    if (!fb || !u?.email) throw new Error('Няма активен акаунт с парола.');
    const cred = EmailAuthProvider.credential(u.email, password);
    await reauthenticateWithCredential(u, cred);
    const uid = u.uid;
    await deleteAllUserCloudData(uid);
    await wipeAllLocalAppData();
    await clearCatchSyncQueue().catch(() => undefined);
    await deleteUser(u);
  }, []);

  const value = useMemo(
    () => ({
      user,
      configured,
      loading,
      signIn,
      signUp,
      signInWithGoogleIdToken,
      signInWithApple,
      signOut,
      resetPassword,
      deleteAccount,
    }),
    [
      user,
      configured,
      loading,
      signIn,
      signUp,
      signInWithGoogleIdToken,
      signInWithApple,
      signOut,
      resetPassword,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth извън AuthProvider');
  return ctx;
}
