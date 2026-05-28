import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  serverTimestamp,
  writeBatch,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
} from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { deleteAllUserDamFeedPosts } from './damFeed';
import { allowSearch } from './socialRateLimit';
import { uploadImageToR2, deleteFromR2 } from './r2Upload';

export type UserPublicSummary = {
  displayName: string;
  email?: string;
  city?: string;
  bio?: string;
  photoUrl?: string;
};

export type SearchUserResult = {
  uid: string;
  displayName: string;
  city?: string;
  photoUrl?: string;
};

/** Prefix search on the users collection by displayName. Requires at least 2
    characters. The Firestore index on `displayName` is case-sensitive, so
    `иван` would never surface `Иван`. We work around that by issuing
    parallel prefix queries for the raw input AND the variant with the first
    character switched in case — covers the realistic scenario where users
    saved their name with a capital letter and someone types lowercase (or
    vice versa). De-duplicated by uid before returning. */
export async function searchUsersByName(
  q: string,
  opts?: { excludeUid?: string; maxResults?: number },
): Promise<SearchUserResult[]> {
  const fb = requireFirebase();
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  // Throttle scripted callers — UI debounces typing, but a determined caller
  // can still drive `searchUsersByName` faster than is reasonable. Key the
  // bucket by excludeUid (the caller's own uid) so multi-user devices each
  // get their own quota. Falls back to a shared bucket when no uid passed.
  const throttleKey = opts?.excludeUid || 'anon';
  if (!allowSearch(throttleKey)) return [];
  const perVariantLimit = opts?.maxResults ?? 20;

  // Build the case variants we'll search. toLocaleUpperCase/LowerCase with
  // 'bg' handles Cyrillic correctly. The Set dedupes when the user already
  // typed the canonical case so we don't run identical queries.
  const firstCharUpper = trimmed.charAt(0).toLocaleUpperCase('bg') + trimmed.slice(1);
  const firstCharLower = trimmed.charAt(0).toLocaleLowerCase('bg') + trimmed.slice(1);
  const variants = Array.from(new Set([trimmed, firstCharUpper, firstCharLower]));

  const runQuery = async (anchor: string) => {
    const snap = await getDocs(
      query(
        collection(fb.db, 'users'),
        orderBy('displayName'),
        startAt(anchor),
        endAt(anchor + ''),
        limit(perVariantLimit),
      ),
    );
    return snap.docs;
  };

  const docLists = await Promise.all(variants.map(runQuery));
  const byUid = new Map<string, SearchUserResult>();
  for (const docs of docLists) {
    for (const d of docs) {
      if (d.id === opts?.excludeUid) continue;
      if (byUid.has(d.id)) continue;
      const data = d.data() as { displayName?: string; city?: string; photoUrl?: string };
      byUid.set(d.id, {
        uid: d.id,
        // Empty string when missing — callers decide their own fallback rather
        // than inheriting the literal "Рибар" placeholder, which had been
        // clobbering caller-known display names downstream.
        displayName: data.displayName?.trim() || '',
        city: data.city?.trim() || undefined,
        photoUrl: data.photoUrl?.trim() || undefined,
      });
    }
  }
  return Array.from(byUid.values()).slice(0, perVariantLimit);
}

/** Best-effort backfill: if the Firestore users/{uid} doc has no displayName
    field, write the one from Firebase Auth so the user is visible to the
    @-mention autocomplete. Skips when there's nothing to write or when the
    field already exists (we never overwrite a user-edited name). */
export async function mirrorAuthDisplayNameIfMissing(
  uid: string,
  authDisplayName: string | null | undefined,
): Promise<void> {
  const name = authDisplayName?.trim();
  if (!uid || !name) return;
  const fb = requireFirebase();
  const ref = doc(fb.db, 'users', uid);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists() && (snap.data() as { displayName?: string }).displayName) {
    return;
  }
  await setDoc(
    ref,
    stripUndefinedForFirestore({ uid, displayName: name, updatedAt: serverTimestamp() }),
    { merge: true },
  ).catch(() => undefined);
}

export async function pushUserProfilePublic(
  uid: string,
  patch: { displayName?: string; city?: string; bio?: string; photoUrl?: string | null }
): Promise<void> {
  const fb = requireFirebase();
  // Only write fields that are explicitly present in `patch`. The old version
  // defaulted missing fields to empty strings, which with `merge: true`
  // overwrote the user's existing values — so a photoUrl-only patch (the
  // avatar auto-save flow) would wipe displayName/city/bio.
  const docPayload: Record<string, unknown> = {
    uid,
    updatedAt: serverTimestamp(),
  };
  if (patch.displayName !== undefined) docPayload.displayName = patch.displayName;
  if (patch.city !== undefined) docPayload.city = patch.city;
  if (patch.bio !== undefined) docPayload.bio = patch.bio;
  if (patch.photoUrl !== undefined) {
    docPayload.photoUrl =
      patch.photoUrl != null && String(patch.photoUrl).trim()
        ? String(patch.photoUrl).trim()
        : deleteField();
  }
  await setDoc(doc(fb.db, 'users', uid), stripUndefinedForFirestore(docPayload), { merge: true });
}

export async function getUserPublicSummary(uid: string): Promise<UserPublicSummary | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data() as {
    displayName?: string;
    email?: string;
    city?: string;
    bio?: string;
    photoUrl?: string;
  };
  const city = d.city != null && String(d.city).trim() ? String(d.city).trim() : undefined;
  const bio = d.bio != null && String(d.bio).trim() ? String(d.bio).trim() : undefined;
  const photoUrl =
    d.photoUrl != null && String(d.photoUrl).trim() ? String(d.photoUrl).trim() : undefined;
  return {
    // Empty string when the Firestore user doc has no displayName field.
    // Returning the literal 'Рибар' here was clobbering caller-known names
    // (e.g. the Auth user's displayName) in UserPublicProfileScreen.
    displayName: (d.displayName && String(d.displayName).trim()) || '',
    email: d.email,
    city,
    bio,
    photoUrl,
  };
}

/**
 * Propagates a display-name change everywhere the old name is denormalized.
 *
 * Background: when a user publishes a catch or post, the `ownerName` field is
 * written as a snapshot of the displayName at publish time. The Firestore
 * users/{uid} doc owns the canonical name, but every existing publicCatches /
 * users/{uid}/catches / posts doc still carries the OLD snapshot — so the
 * user's feed cards show the previous name even after they rename. Same for
 * the Firebase Auth user.displayName, which is what the sync queue reads
 * when uploading NEW catches in the background; without re-syncing it, the
 * very next catch the user saves picks up the old name from Auth and the
 * mismatch perpetuates.
 *
 * This function fans the new name out to:
 *   1. Firebase Auth currentUser.displayName  → makes future catches correct
 *   2. publicCatches where ownerUid == uid    → public feed
 *   3. users/{uid}/catches subcollection      → owner's logbook view
 *   4. posts where ownerUid == uid            → text/photo posts feed
 *
 * Out of scope (intentional):
 *   - comments / replies: would need a collectionGroup scan across thousands
 *     of catches; cost outweighs benefit since comment-author names update on
 *     next render via lookup in most cases.
 *   - notifications.actorName: ephemeral (24-48h life), low value.
 *   - stories.userName: 24h TTL — natural decay.
 *   - liveFishingPins.ownerName: 24h TTL.
 *   - leaderboardCache: scheduled function rebuilds nightly with fresh names.
 *
 * All writes are best-effort and chunked. A failure on any single sub-fanout
 * doesn't abort the others — the user's name change still lands in the
 * canonical users/{uid} doc via pushUserProfilePublic regardless.
 */
export async function refreshOwnerDisplayName(uid: string, newName: string): Promise<void> {
  const fb = requireFirebase();
  const trimmed = newName.trim().slice(0, 120);
  if (!trimmed) return;

  // 1. Firebase Auth — must run on the current session. Wraps in try so a
  //    transient auth error doesn't block the Firestore fanout below.
  try {
    const current = fb.auth.currentUser;
    if (current && current.uid === uid && current.displayName !== trimmed) {
      await updateProfile(current, { displayName: trimmed });
    }
  } catch { /* best-effort */ }

  // Helper: read a snapshot, batch-update the `ownerName` field on each doc.
  // Caps at 500 docs per source — a single user with 500+ catches is the
  // long-tail; we'd rather not surprise-bill them on rename. Chunks at 400
  // per batch (Firestore's 500-op limit minus margin).
  const fanout = async (qSnapPromise: Promise<{ docs: { ref: import('firebase/firestore').DocumentReference }[] }>) => {
    try {
      const snap = await qSnapPromise;
      if (snap.docs.length === 0) return;
      const CHUNK = 400;
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const b = writeBatch(fb.db);
        snap.docs.slice(i, i + CHUNK).forEach((d) => {
          b.update(d.ref, { ownerName: trimmed });
        });
        await b.commit();
      }
    } catch { /* best-effort per-source */ }
  };

  // Run the three Firestore fanouts in parallel — they touch disjoint
  // collections so there's no contention to worry about.
  await Promise.all([
    fanout(getDocs(query(collection(fb.db, 'publicCatches'), where('ownerUid', '==', uid), limit(500)))),
    fanout(getDocs(query(collection(fb.db, 'users', uid, 'catches'), limit(500)))),
    fanout(getDocs(query(collection(fb.db, 'posts'), where('ownerUid', '==', uid), limit(500)))),
  ]);
}

export async function uploadProfileAvatar(uid: string, localUri: string): Promise<string> {
  // Cache-bust the filename so the new avatar replaces the old one in any
  // image cache (CDN, expo-image, React Native's bitmap cache). The previous
  // shape used a fixed `avatar.jpg` key — fine on Firebase Storage because
  // the download URL carried a token that changed on each upload, but on
  // R2 the public URL is the bare path. Without a varying segment, viewers
  // would see the stale image until cache TTL expired.
  const storagePath = `profilePhotos/${uid}/avatar_${Date.now()}.jpg`;
  const { url } = await uploadImageToR2(localUri, storagePath, undefined, {
    // Avatars render at small sizes — 800px is more than enough for a
    // 2× retina display, and the smaller file uploads + serves faster.
    maxDimension: 800,
  });
  return url;
}

export async function deleteProfileAvatar(uid: string, storagePath?: string): Promise<void> {
  // Caller passes the path if they have it (e.g. from the user doc). Without
  // it we can't enumerate R2 to find prior avatars — but the most recent
  // upload's path lives on `users/{uid}.photoStoragePath`, so callers should
  // read that and pass it. Falling back to a guess would silently delete the
  // wrong object on the timestamp-suffixed scheme.
  if (!storagePath) return;
  await deleteFromR2(storagePath);
}

/**
 * Returns the avatar URL stored on the user's Firestore doc, if any. We no
 * longer probe R2 directly — the canonical URL lives at `users/{uid}.photoUrl`
 * (kept in sync by `pushUserProfilePublic`). Trying to derive the URL from
 * R2 directly was a workaround for Firebase Storage's tokenized URLs, which
 * R2 doesn't have.
 */
export async function tryGetStoredProfileAvatarUrl(uid: string): Promise<string | undefined> {
  const fb = requireFirebase();
  try {
    const snap = await getDoc(doc(fb.db, 'users', uid));
    if (!snap.exists()) return undefined;
    const url = (snap.data() as { photoUrl?: unknown })?.photoUrl;
    if (typeof url !== 'string') return undefined;
    const trimmed = url.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

// Presence lives in users/{uid}/presence/state — a dedicated tiny doc so
// presence subscribers don't re-fire on every unrelated field change on the
// parent user doc (photoUrl, unreadMessageCount, displayName, etc.). The old
// users/{uid}.online / .lastSeen fields are intentionally not cleaned up;
// they become orphaned data that nothing reads anymore.
export async function updateUserPresence(uid: string, online: boolean): Promise<void> {
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'users', uid, 'presence', 'state'),
    stripUndefinedForFirestore({ online, lastSeen: serverTimestamp() }),
    { merge: true },
  ).catch(() => {});
}

// Module-level registry of active presence subscriptions, keyed by uid. When
// multiple components (e.g. ChatRow + ChatDetail header + ActiveContactsRail)
// all subscribe to the same user's presence, they share one Firestore
// listener instead of opening N. Each component gets its own callback fired
// from the shared snapshot dispatch. Counts callbacks per uid; the Firestore
// unsubscribe runs only when the last subscriber drops.
type PresenceState = { online: boolean; lastSeen?: number };
type PresenceListener = (p: PresenceState) => void;
type PresenceRegistryEntry = {
  listeners: Set<PresenceListener>;
  last: PresenceState;
  unsubFirestore: () => void;
};
const presenceRegistry = new Map<string, PresenceRegistryEntry>();

export function subscribeUserPresence(
  uid: string,
  onNext: PresenceListener,
): () => void {
  if (!uid) { onNext({ online: false }); return () => {}; }
  let entry = presenceRegistry.get(uid);
  if (!entry) {
    const fb = requireFirebase();
    const listeners = new Set<PresenceListener>();
    const initialState: PresenceState = { online: false };
    const dispatch = (next: PresenceState) => {
      // Only re-render subscribers when something actually changed.
      const e = presenceRegistry.get(uid);
      if (!e) return;
      if (e.last.online === next.online && e.last.lastSeen === next.lastSeen) return;
      e.last = next;
      for (const cb of e.listeners) {
        try { cb(next); } catch { /* swallow per-subscriber errors */ }
      }
    };
    const unsubFirestore = onSnapshot(
      doc(fb.db, 'users', uid, 'presence', 'state'),
      (snap) => {
        if (!snap.exists()) { dispatch({ online: false }); return; }
        const d = snap.data() as { online?: boolean; lastSeen?: { toMillis?: () => number } };
        dispatch({
          online: !!d.online,
          lastSeen: d.lastSeen?.toMillis?.() ?? undefined,
        });
      },
      () => dispatch({ online: false }),
    );
    entry = { listeners, last: initialState, unsubFirestore };
    presenceRegistry.set(uid, entry);
  }
  entry.listeners.add(onNext);
  // Push the cached last value synchronously so new subscribers don't see a
  // flash of offline before Firestore re-emits.
  if (entry.last.online || entry.last.lastSeen) onNext(entry.last);

  return () => {
    const e = presenceRegistry.get(uid);
    if (!e) return;
    e.listeners.delete(onNext);
    // Last subscriber dropped — tear down the Firestore listener too.
    if (e.listeners.size === 0) {
      e.unsubFirestore();
      presenceRegistry.delete(uid);
    }
  };
}

/**
 * Server-side cascade — invokes the `deleteMyAccount` Cloud Function. This is
 * the preferred delete path because it has admin-SDK access and can clean
 * data the client can't (other users' subcollections holding our backrefs,
 * conversation soft-deletes, group memberships, etc.). The client-side
 * fallback below stays as a safety net for callers that hit it before the
 * functions deploy lands.
 */
export async function deleteMyAccountCloudCascade(): Promise<void> {
  const fb = requireFirebase();
  // Dynamic import to keep the firebase/functions bundle out of the cold-start
  // path for users who never delete their account.
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fns = getFunctions(fb.app);
  const fn = httpsCallable(fns, 'deleteMyAccount');
  await fn({});
}

export async function deleteAllUserCloudData(uid: string): Promise<void> {
  const fb = requireFirebase();
  await deleteAllUserDamFeedPosts(uid);

  // Remove this user from every follower's "following" list before deleting the followers mirror
  const followersSnap = await getDocs(collection(fb.db, 'users', uid, 'followers')).catch(() => null);
  if (followersSnap && !followersSnap.empty) {
    let backlinkBatch = writeBatch(fb.db);
    let bn = 0;
    for (const d of followersSnap.docs) {
      backlinkBatch.delete(doc(fb.db, 'users', d.id, 'following', uid));
      bn++;
      if (bn >= 400) {
        await backlinkBatch.commit();
        backlinkBatch = writeBatch(fb.db);
        bn = 0;
      }
    }
    if (bn > 0) await backlinkBatch.commit();
  }

  const subs = ['catches', 'spots', 'following', 'followers', 'joinedTournaments', 'notifications', 'savedCatches'] as const;
  for (const sub of subs) {
    const snap = await getDocs(collection(fb.db, 'users', uid, sub));
    let batch = writeBatch(fb.db);
    let n = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      n++;
      if (n >= 400) {
        await batch.commit();
        batch = writeBatch(fb.db);
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }

  const pub = await getDocs(query(collection(fb.db, 'publicCatches'), where('ownerUid', '==', uid)));
  let batch = writeBatch(fb.db);
  let n = 0;
  for (const d of pub.docs) {
    batch.delete(d.ref);
    n++;
    if (n >= 400) {
      await batch.commit();
      batch = writeBatch(fb.db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();

  await deleteDoc(doc(fb.db, 'users', uid)).catch(() => undefined);
}
