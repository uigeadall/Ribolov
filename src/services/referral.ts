import AsyncStorage from '../storage/kv';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ensureFirebase } from './firebase';

/**
 * Friend-invite / referral attribution.
 *
 * Flow:
 *   1. User A taps "Покани приятел" → app shares URL `ribolov-app://invite/<A.uid>`.
 *   2. User B taps the link; the app's URL handler in App.tsx calls
 *      `storePendingReferrer(A.uid)`, stashing it in AsyncStorage.
 *   3. User B signs up (or signs in for the first time on this device); the
 *      onAuthStateChanged hook in authContext calls `acceptPendingReferral`.
 *      That writes `invitedBy: A.uid` onto users/B.uid (merge, only if not
 *      already attributed) and clears the pending key.
 *
 * Why AsyncStorage instead of routing the inviter UID through the signup
 * form: deep links arrive at the OS level long before any UI is mounted,
 * and on cold-start they're delivered via getInitialURL well before the
 * AuthProvider has decided whether to show AuthScreen. Persisting to disk
 * lets attribution survive the splash + onboarding gap and a possible
 * re-launch.
 *
 * Self-invite is a no-op (we silently drop it) — the only way to hit that
 * path is opening your own share link to test, and writing your own uid
 * into your own `invitedBy` field would corrupt analytics.
 */

const PENDING_REFERRER_KEY = '@ribolov/pendingReferrer';
const INVITE_PATH_PREFIX = 'invite/';

/** Build the shareable URL for a given user. Uses the app's custom URL
    scheme registered in app.json. Universal Links / a web fallback are
    deferred — for now, users without the app installed see a non-clickable
    URL alongside the marketing text, which is acceptable for v1. */
export function getInviteUrl(uid: string): string {
  return `ribolov-app://${INVITE_PATH_PREFIX}${uid}`;
}

/** Default share message — Bulgarian, includes the inviter link. */
export function buildInviteShareMessage(uid: string): string {
  const url = getInviteUrl(uid);
  return (
    'Хей! Свали Риболов — приложението за дневник на улови, ' +
    'спотове и турнири.\n\n' +
    'Линк за покана: ' + url
  );
}

/** Parse a deep link URL and return the inviter uid if it's an invite link.
    Tolerates either `ribolov-app://invite/<uid>` or `https://...invite/<uid>`
    so a future Universal-Links / web-redirect setup drops in without
    rewriting the handler. */
export function parseInviteUrl(url: string): string | null {
  if (!url) return null;
  const idx = url.indexOf(INVITE_PATH_PREFIX);
  if (idx < 0) return null;
  const tail = url.slice(idx + INVITE_PATH_PREFIX.length);
  // Strip any trailing query / hash so a tracking suffix doesn't pollute
  // the uid (defensive — none are added today, but third-party share UIs
  // sometimes append their own params).
  const uid = tail.split(/[?#/]/)[0]?.trim();
  return uid && uid.length > 0 ? uid : null;
}

/** Stash an inviter uid for redemption on next sign-in. Idempotent —
    re-storing the same uid is a no-op. */
export async function storePendingReferrer(inviterUid: string): Promise<void> {
  if (!inviterUid) return;
  try {
    await AsyncStorage.setItem(PENDING_REFERRER_KEY, inviterUid);
  } catch {
    /* best-effort — losing the attribution is preferable to a crash */
  }
}

/** Called from authContext after onAuthStateChanged delivers a user.
    Writes `invitedBy` to the user doc the first time it's missing, then
    clears the pending key. Subsequent sign-ins for the same user (or any
    user whose doc already has `invitedBy`) become no-ops, so a returning
    user who happens to tap a friend's link doesn't get re-attributed. */
export async function acceptPendingReferral(newUserUid: string): Promise<void> {
  if (!newUserUid) return;
  let inviterUid: string | null = null;
  try {
    inviterUid = await AsyncStorage.getItem(PENDING_REFERRER_KEY);
  } catch {
    return;
  }
  if (!inviterUid) return;
  // Self-invite is meaningless — drop the pending key without writing.
  if (inviterUid === newUserUid) {
    await AsyncStorage.removeItem(PENDING_REFERRER_KEY).catch(() => undefined);
    return;
  }
  const fb = ensureFirebase();
  if (!fb) return;
  try {
    const userRef = doc(fb.db, 'users', newUserUid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data()?.invitedBy) {
      // Already attributed — never overwrite. Drop the pending key so a
      // returning user doesn't keep dragging stale attribution forward.
      await AsyncStorage.removeItem(PENDING_REFERRER_KEY).catch(() => undefined);
      return;
    }
    // Include `uid` in the payload to satisfy the user-doc Firestore rule
    // (`request.resource.data.uid == userId`). For OAuth signups (Google /
    // Apple / Facebook) the users/{uid} doc may not exist yet when this
    // runs — pushUserProfilePublic is only called by the email signup
    // path — so a plain merge write without `uid` would be treated as a
    // CREATE missing the required field and get rejected.
    await setDoc(
      userRef,
      { uid: newUserUid, invitedBy: inviterUid, invitedAt: serverTimestamp() },
      { merge: true },
    );
    await AsyncStorage.removeItem(PENDING_REFERRER_KEY).catch(() => undefined);
  } catch {
    // Network / rules error — keep the pending key so the next sign-in
    // attempt can retry. Acceptable because the redeem step is idempotent.
  }
}
