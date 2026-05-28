import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '../storage/kv';
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
  FacebookAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { ensureFirebase } from './firebase';
import { isFirebaseConfigured } from './firebaseConfig';
import { deleteAllUserCloudData, deleteMyAccountCloudCascade, updateUserPresence } from './cloudSync';
import { wipeAllLocalAppData } from '../storage/storage';
import { clearCatchSyncQueue, flushPendingCatchSync } from './catchSyncQueue';
import { flushPendingMessages } from './messageSyncQueue';
import { clearPushToken, registerForPushNotifications } from './pushNotifications';
import { restoreAchievementsFromCloud } from './achievements';
import { resetSocialCaches } from './social';
import { resetTournamentCaches } from './tournaments';
import { resetRateLimits } from './socialRateLimit';
import { pushUserProfilePublic, mirrorAuthDisplayNameIfMissing } from './userProfile';
import { setObservabilityUser } from './observability';
import { setAnalyticsUser } from './analytics';
import { acceptPendingReferral } from './referral';

export type AuthContextValue = {
  user: User | null;
  configured: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithApple: (idToken: string, rawNonce: string) => Promise<void>;
  signInWithFacebook: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: (credential: DeleteAccountCredential) => Promise<void>;
};

export type DeleteAccountCredential =
  | { provider: 'password'; password: string }
  | { provider: 'google'; idToken: string }
  | { provider: 'apple'; idToken: string; rawNonce: string };

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
          // Backfill the Firestore users/{uid}.displayName mirror for legacy
          // accounts that signed up via Google/Apple/Facebook before this
          // mirror was wired into signUp. Without it those users don't appear
          // in @-mention autocomplete (the search orders by displayName, which
          // requires the field to exist). Only writes when the field is
          // currently missing so we never overwrite a user-edited name.
          mirrorAuthDisplayNameIfMissing(u.uid, u.displayName).catch(() => undefined);
          // Redeem any pending friend-invite deep link captured by App.tsx
          // before/during sign-up. No-op if there's nothing pending or the
          // user is already attributed — see referral.acceptPendingReferral
          // for the idempotency rules.
          acceptPendingReferral(u.uid).catch(() => undefined);
        }
        // LAST_UID_KEY is intentionally NOT cleared on the signed-out branch
        // — keep the last-signed-in uid persisted so that if a different user
        // signs in next, the mismatch check above triggers the data wipe.
        // Clearing it here would let user B sign in after A and inherit A's
        // local catches/spots/gear.
        // Tag observability events with the current user. After Sentry was
        // removed this is a no-op, but kept wired so future error-reporter
        // integrations pick up user identity automatically.
        setObservabilityUser(u?.uid ?? null, u?.displayName);
        // Attribute Firebase Analytics events to the user. Mirrors the
        // observability call above; same null-on-signout semantics so the
        // next user on this device doesn't inherit the previous identity.
        setAnalyticsUser(u?.uid ?? null);
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
    if (name) {
      await updateProfile(cred.user, { displayName: name });
      // Mirror the displayName into the Firestore users/{uid} doc so that
      // getUserPublicSummary returns a real name (rather than empty) the
      // first time anyone views this user's public profile. Without this,
      // new email-signup users showed up as "Рибар" in the public preview
      // until they manually saved the edit-profile form.
      await pushUserProfilePublic(cred.user.uid, { displayName: name }).catch(() => {});
    }
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

  const signInWithFacebook = useCallback(async (accessToken: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    const cred = FacebookAuthProvider.credential(accessToken);
    await signInWithCredential(fb.auth, cred);
  }, []);

  const signOut = useCallback(async () => {
    const fb = ensureFirebase();
    const u = fb?.auth.currentUser;
    if (u) {
      await updateUserPresence(u.uid, false).catch(() => undefined);
      // Clear this user's push-token doc BEFORE auth signOut. Otherwise the
      // device token stays mapped to the previous account and a follow-up
      // sign-in (different user, same device) would have BOTH accounts
      // pointing at the same Expo token. Push notifications to the old
      // account would buzz the new account's device.
      await clearPushToken(u.uid).catch(() => undefined);
    }
    let signOutOk = true;
    try {
      if (fb) await firebaseSignOut(fb.auth);
    } catch {
      signOutOk = false;
    }
    if (!signOutOk) {
      // Sign-out genuinely failed (offline, App Check refresh).
      // Let the user retry from a known state.
      throw new Error('Не успяхме да те отпишем. Опитай отново след малко.');
    }
    // Keep local data (catches, spots, gear, trips) on sign-out so the same
    // user signing back in still sees their logbook. Different-user safety is
    // enforced by the onAuthStateChanged effect above, which compares the new
    // uid to LAST_UID_KEY and wipes on mismatch. Wiping here was unsafe — it
    // also fired when the same user signed back in, losing all their catches.
    // LAST_UID_KEY is preserved on sign-out so that the mismatch check still
    // triggers when a different account signs in next.
    // Drop in-memory caches so the next account on this device doesn't see
    // the previous user's follow list, suggestions, rate-limit state, or
    // cached tournament standings.
    resetSocialCaches();
    resetTournamentCaches();
    resetRateLimits();
    setUser(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const fb = ensureFirebase();
    if (!fb) throw new Error('Firebase не е конфигуриран.');
    await sendPasswordResetEmail(fb.auth, email.trim());
  }, []);

  const deleteAccount = useCallback(async (credential: DeleteAccountCredential) => {
    const fb = ensureFirebase();
    const u = fb?.auth.currentUser;
    if (!fb || !u) throw new Error('Няма активен акаунт.');
    let authCred;
    if (credential.provider === 'google') {
      authCred = GoogleAuthProvider.credential(credential.idToken);
    } else if (credential.provider === 'apple') {
      const appleProvider = new OAuthProvider('apple.com');
      authCred = appleProvider.credential({ idToken: credential.idToken, rawNonce: credential.rawNonce });
    } else {
      if (!u.email) throw new Error('Акаунтът няма имейл за потвърждение.');
      authCred = EmailAuthProvider.credential(u.email, credential.password);
    }
    await reauthenticateWithCredential(u, authCred);
    const uid = u.uid;
    // Prefer the Cloud Function cascade — it has admin-SDK reach and cleans
    // far more (other users' backrefs, conversations, groups, tournaments).
    // Fall back to the client-side scrub if the function deploy hasn't landed
    // or the call fails for a network reason — better partial cleanup than
    // none.
    try {
      await deleteMyAccountCloudCascade();
    } catch {
      await deleteAllUserCloudData(uid).catch(() => undefined);
    }
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
      signInWithFacebook,
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
      signInWithFacebook,
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
