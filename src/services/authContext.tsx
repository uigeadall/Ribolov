import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
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
} from 'firebase/auth';
import { ensureFirebase } from './firebase';
import { isFirebaseConfigured } from './firebaseConfig';
import { deleteAllUserCloudData } from './cloudSync';
import { wipeAllLocalAppData } from '../storage/storage';
import { clearCatchSyncQueue, flushPendingCatchSync } from './catchSyncQueue';

export type AuthContextValue = {
  user: User | null;
  configured: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithApple: (idToken: string, rawNonce: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      const fb = ensureFirebase();
      const u = fb?.auth.currentUser;
      if (u)
        void flushPendingCatchSync({
          user: { uid: u.uid, displayName: u.displayName, email: u.email },
        });
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
      setUser(u);
      setLoading(false);
      if (u) {
        flushPendingCatchSync({
          user: { uid: u.uid, displayName: u.displayName, email: u.email },
        }).catch(() => undefined);
      }
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
    if (fb) await firebaseSignOut(fb.auth);
    else setUser(null);
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
