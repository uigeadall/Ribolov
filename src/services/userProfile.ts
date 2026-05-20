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
import { ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { deleteAllUserDamFeedPosts } from './damFeed';

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
  const docPayload: Record<string, unknown> = {
    uid,
    displayName: patch.displayName ?? '',
    city: patch.city ?? '',
    bio: patch.bio ?? '',
    updatedAt: serverTimestamp(),
  };
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

export async function uploadProfileAvatar(uid: string, localUri: string): Promise<string> {
  const fb = requireFirebase();
  const token = await fb.auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Не е влезено в акаунт.');

  const bucket = 'ribolov-4ef41.firebasestorage.app';
  const storagePath = `profilePhotos/${uid}/avatar.jpg`;

  // FileSystem.uploadAsync sends raw binary natively — no Blob/ArrayBuffer in JS.
  const result = await uploadAsync(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
    localUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Качването не бе успешно (${result.status}): ${result.body}`);
  }

  const meta = JSON.parse(result.body) as { name: string; downloadTokens: string };
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(meta.name)}?alt=media&token=${meta.downloadTokens}`;
}

export async function deleteProfileAvatar(uid: string): Promise<void> {
  const fb = requireFirebase();
  try {
    await deleteObject(ref(fb.storage, `profilePhotos/${uid}/avatar.jpg`));
  } catch {
    // Ignore — file may not exist
  }
}

export async function tryGetStoredProfileAvatarUrl(uid: string): Promise<string | undefined> {
  const fb = requireFirebase();
  try {
    const storageRef = ref(fb.storage, `profilePhotos/${uid}/avatar.jpg`);
    const url = await getDownloadURL(storageRef);
    const trimmed = url.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function updateUserPresence(uid: string, online: boolean): Promise<void> {
  const fb = requireFirebase();
  await updateDoc(doc(fb.db, 'users', uid), {
    online,
    lastSeen: serverTimestamp(),
  }).catch(() => {});
}

export function subscribeUserPresence(
  uid: string,
  onNext: (presence: { online: boolean; lastSeen?: number }) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, 'users', uid), (snap) => {
    if (!snap.exists()) { onNext({ online: false }); return; }
    const d = snap.data() as { online?: boolean; lastSeen?: { toMillis?: () => number } };
    onNext({
      online: !!d.online,
      lastSeen: d.lastSeen?.toMillis?.() ?? undefined,
    });
  }, () => onNext({ online: false }));
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
