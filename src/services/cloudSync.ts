import {
  collection,
  collectionGroup,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  deleteField,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  addDoc,
  writeBatch,
  documentId,
  getCountFromServer,
  onSnapshot,
  startAfter,
  increment,
  updateDoc,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { ensureFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { deleteAllUserDamFeedPosts } from './damFeed';
import { getCloudinaryUploadConfig, uploadImageToCloudinary } from './cloudinaryConfig';
import type { Catch, DirectMessage, Tournament } from '../types';

export type CloudCatch = Catch & {
  ownerUid: string;
  ownerName?: string;
  ownerPhotoUrl?: string;
  isPublic?: boolean;
  syncedAt?: unknown;
};

export type FeedItem = CloudCatch;

const CLOUDINARY_PREFIX = 'cloudinary:';

function isRemote(uri?: string) {
  return !!uri && /^https?:\/\//i.test(uri.trim());
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export async function ensureCatchPhotoUploadedForCloud(c: Catch, ownerUid: string): Promise<Catch> {
  const uri = c.photoUri?.trim();
  if (!uri || isRemote(uri)) return c;
  const cloud = getCloudinaryUploadConfig();
  if (cloud) {
    const { secureUrl, publicId } = await withRetry(() =>
      uploadImageToCloudinary(uri, cloud.cloudName, cloud.uploadPreset)
    );
    return { ...c, photoUri: secureUrl, photoStoragePath: `${CLOUDINARY_PREFIX}${publicId}` };
  }
  const fb = ensureFirebase();
  if (!fb) throw new Error('Няма Firebase/Cloudinary за качване на снимка.');
  const extMatch = uri.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `publicCatchPhotos/${ownerUid}/${c.id}/${Date.now()}.${ext}`;
  const storageRef = ref(fb.storage, path);
  const url = await withRetry(async () => {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    await uploadBytes(storageRef, blob, { contentType });
    return getDownloadURL(storageRef);
  });
  return { ...c, photoUri: url, photoStoragePath: path };
}

export async function pushCatch(c: Catch, ownerUid: string, ownerName: string, isPublic: boolean) {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const userSnap = await getDoc(doc(fb.db, 'users', ownerUid));
  const rawPhoto =
    userSnap.exists() && typeof userSnap.data()?.photoUrl === 'string'
      ? String(userSnap.data()?.photoUrl).trim()
      : '';
  const ownerPhotoPatch =
    rawPhoto !== '' ? { ownerPhotoUrl: rawPhoto } : { ownerPhotoUrl: deleteField() };
  const rawPayload: Record<string, unknown> = {
    ...c,
    syncedToCloud: true,
    ownerUid,
    ownerName,
    isPublic: !!isPublic,
    syncedAt: serverTimestamp(),
    ...ownerPhotoPatch,
  };
  const payload = stripUndefinedForFirestore(rawPayload);
  await setDoc(doc(fb.db, 'users', ownerUid, 'catches', c.id), payload, { merge: true });
  if (isPublic) {
    await setDoc(doc(fb.db, 'publicCatches', c.id), payload, { merge: true });
  }
}

export type FeedPage = {
  items: CloudCatch[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
};

export async function fetchPublicFeed(
  maxItems = 20,
  afterDoc?: DocumentSnapshot | null
): Promise<FeedPage> {
  const fb = ensureFirebase();
  if (!fb) return { items: [], lastDoc: null, hasMore: false };
  // Fetch one extra to know if another page exists
  const constraints: Parameters<typeof query>[1][] = [
    orderBy('date', 'desc'),
    limit(maxItems + 1),
  ];
  if (afterDoc) constraints.push(startAfter(afterDoc));
  const snap = await getDocs(query(collection(fb.db, 'publicCatches'), ...constraints));
  const hasMore = snap.docs.length > maxItems;
  const docs = hasMore ? snap.docs.slice(0, maxItems) : snap.docs;
  return {
    items: docs.map((d) => d.data() as CloudCatch),
    lastDoc: docs[docs.length - 1] ?? null,
    hasMore,
  };
}

/** Зарежда публични улови по ID (редът следва подадения масив). */
export async function fetchPublicCatchesByIds(ids: string[]): Promise<CloudCatch[]> {
  const fb = ensureFirebase();
  if (!fb || ids.length === 0) return [];
  const uniq = [...new Set(ids)];
  const snaps = await Promise.all(uniq.map((id) => getDoc(doc(fb.db, 'publicCatches', id))));
  const byId = new Map<string, CloudCatch>();
  for (const s of snaps) {
    if (s.exists()) byId.set(s.id, s.data() as CloudCatch);
  }
  return uniq.map((id) => byId.get(id)).filter((c): c is CloudCatch => c != null);
}

export async function fetchPublicCatchesSince(minDateIso: string, maxCount = 2500): Promise<CloudCatch[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const q = query(
    collection(fb.db, 'publicCatches'),
    where('date', '>=', minDateIso),
    orderBy('date', 'desc'),
    limit(maxCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CloudCatch);
}

export async function fetchPublicCatchesByOwner(ownerUid: string, maxItems = 40): Promise<CloudCatch[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const q = query(
    collection(fb.db, 'publicCatches'),
    where('ownerUid', '==', ownerUid),
    orderBy('date', 'desc'),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CloudCatch);
}

export type UserPublicSummary = {
  displayName: string;
  email?: string;
  city?: string;
  bio?: string;
  photoUrl?: string;
};

export async function pushUserProfilePublic(
  uid: string,
  patch: { displayName?: string; city?: string; bio?: string; photoUrl?: string | null }
): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
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
  const fb = ensureFirebase();
  if (!fb) return null;
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
    displayName: (d.displayName && String(d.displayName).trim()) || 'Рибар',
    email: d.email,
    city,
    bio,
    photoUrl,
  };
}

/** Публичен аватар в Firebase Storage → записва се като photoUrl в профила. */
export async function uploadProfileAvatar(uid: string, localUri: string): Promise<string> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');

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
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Качването не бе успешно (${result.status}): ${result.body}`);
  }

  const meta = JSON.parse(result.body) as { name: string; downloadTokens: string };
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(meta.name)}?alt=media&token=${meta.downloadTokens}`;
}

/** Изтрива аватар от Storage — използва се за почистване при неуспешен запис в Firestore. */
export async function deleteProfileAvatar(uid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  try {
    await deleteObject(ref(fb.storage, `profilePhotos/${uid}/avatar.jpg`));
  } catch {
    // Ignore — file may not exist
  }
}

/** Възстановява URL на аватара от Storage, ако документът в Firestore няма photoUrl. */
export async function tryGetStoredProfileAvatarUrl(uid: string): Promise<string | undefined> {
  const fb = ensureFirebase();
  if (!fb) return undefined;
  try {
    const storageRef = ref(fb.storage, `profilePhotos/${uid}/avatar.jpg`);
    const url = await getDownloadURL(storageRef);
    const trimmed = url.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function getFollowerCount(targetUid: string): Promise<number> {
  const fb = ensureFirebase();
  if (!fb || !targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'followers'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function getFollowingCount(targetUid: string): Promise<number> {
  const fb = ensureFirebase();
  if (!fb || !targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'following'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function isFollowingUser(myUid: string, targetUid: string): Promise<boolean> {
  const fb = ensureFirebase();
  if (!fb || !myUid || !targetUid) return false;
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'following', targetUid));
  return snap.exists();
}

export async function followUser(myUid: string, targetUid: string, targetName?: string) {
  const fb = ensureFirebase();
  if (!fb) return;
  const batch = writeBatch(fb.db);
  // myUid's following list
  batch.set(
    doc(fb.db, 'users', myUid, 'following', targetUid),
    stripUndefinedForFirestore({ uid: targetUid, displayName: targetName ?? '', createdAt: serverTimestamp() }),
  );
  // targetUid's followers list (mirror) — used for follower count
  batch.set(
    doc(fb.db, 'users', targetUid, 'followers', myUid),
    stripUndefinedForFirestore({ uid: myUid, createdAt: serverTimestamp() }),
  );
  await batch.commit();
}

export async function unfollowUser(myUid: string, targetUid: string) {
  const fb = ensureFirebase();
  if (!fb) return;
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'users', myUid, 'following', targetUid));
  batch.delete(doc(fb.db, 'users', targetUid, 'followers', myUid));
  await batch.commit();
}

export async function getFollowing(myUid: string) {
  const fb = ensureFirebase();
  if (!fb) return [];
  const snap = await getDocs(collection(fb.db, 'users', myUid, 'following'));
  return snap.docs.map((d) => {
    const data = d.data() as { uid?: string; displayName?: string };
    return { uid: d.id, displayName: data.displayName ?? '' };
  });
}

export async function isMutualFollow(myUid: string, otherUid: string): Promise<boolean> {
  const fb = ensureFirebase();
  if (!fb || !myUid || !otherUid || myUid === otherUid) return false;
  const [mine, theirs] = await Promise.all([
    getDoc(doc(fb.db, 'users', myUid, 'following', otherUid)),
    getDoc(doc(fb.db, 'users', otherUid, 'following', myUid)),
  ]);
  return mine.exists() && theirs.exists();
}

export async function ensureDirectConversation(
  myUid: string,
  myName: string,
  otherUid: string,
  otherName: string
): Promise<string> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е конфигуриран');
  const participantIds = [myUid, otherUid].sort();
  const convId = participantIds.join('_');
  const convRef = doc(fb.db, 'conversations', convId);
  // Read first to avoid overwriting lastMessageAt on re-open.
  // The rule now allows reading non-existent docs (resource == null), so this is safe.
  const existing = await getDoc(convRef).catch(() => null);
  const isNew = !existing?.exists();
  await setDoc(
    convRef,
    stripUndefinedForFirestore({
      participantIds,
      participantNames: { [myUid]: myName, [otherUid]: otherName },
      ...(isNew ? { lastMessageAt: serverTimestamp() } : {}),
    }),
    { merge: true }
  );
  return convId;
}

export async function listMyConversations(myUid: string, maxCount = 50): Promise<
  { convId: string; otherUid: string; otherName: string; lastMessage?: string; lastMessageAt?: number; unreadCount: number }[]
> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    limit(maxCount),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => {
    const data = d.data() as {
      participantIds: string[];
      participantNames?: Record<string, string>;
      lastMessage?: string;
      lastMessageAt?: { toMillis?: () => number } | number;
      unreadCounts?: Record<string, number>;
    };
    const other = data.participantIds.find((id) => id !== myUid) ?? '';
    const ts = data.lastMessageAt;
    const lastMessageAt = ts
      ? typeof ts === 'number' ? ts : ts.toMillis?.() ?? 0
      : 0;
    return {
      convId: d.id,
      otherUid: other,
      otherName: data.participantNames?.[other] ?? 'Рибар',
      lastMessage: data.lastMessage,
      lastMessageAt,
      unreadCount: data.unreadCounts?.[myUid] ?? 0,
    };
  });
  // Most recent conversation first
  return rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function subscribeConversationMessages(
  convId: string,
  onNext: (msgs: DirectMessage[]) => void,
  onError?: (e: Error) => void
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(300)
  );
  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((d) => {
          const data = d.data() as { senderUid: string; text: string; createdAt?: unknown; mediaUrl?: string; mediaType?: 'photo' | 'video' };
          return { id: d.id, senderUid: data.senderUid, text: data.text, createdAt: data.createdAt, mediaUrl: data.mediaUrl, mediaType: data.mediaType };
        })
      );
    },
    (err) => onError?.(err as Error)
  );
}

export async function sendConversationMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const trimmed = text.trim();
  if (!trimmed && !mediaUrl) return;
  // Send message and update conversation metadata atomically
  await addDoc(
    collection(fb.db, 'conversations', convId, 'messages'),
    stripUndefinedForFirestore({ senderUid, text: trimmed, createdAt: serverTimestamp(), mediaUrl, mediaType }),
  );
  // Update metadata + increment recipient badge count separately
  // (updateDoc is unambiguous for security rules; increment() creates the field if absent)
  await updateDoc(doc(fb.db, 'conversations', convId), {
    lastMessage: mediaUrl ? (mediaType === 'video' ? '📹 Видео' : '📷 Снимка') : trimmed,
    lastMessageAt: serverTimestamp(),
    lastSenderUid: senderUid,
    [`unreadCounts.${recipientUid}`]: increment(1),
  });
}

/** Reset unread count for myUid when they open a chat. */
export async function markConversationRead(convId: string, myUid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await updateDoc(doc(fb.db, 'conversations', convId), {
    [`unreadCounts.${myUid}`]: 0,
  }).catch(() => {});
}

/** Real-time total unread message count across all conversations for myUid. */
export function subscribeUnreadMessagesCount(
  myUid: string,
  onNext: (count: number) => void,
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
  );
  return onSnapshot(q, (snap) => {
    let total = 0;
    snap.docs.forEach((d) => {
      const counts = (d.data() as Record<string, unknown>).unreadCounts as Record<string, number> | undefined;
      total += counts?.[myUid] ?? 0;
    });
    onNext(total);
  }, () => onNext(0));
}

export async function createTournament(t: Tournament) {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const raw = { ...t, createdAt: serverTimestamp() } as Record<string, unknown>;
  await setDoc(doc(fb.db, 'tournaments', t.id), stripUndefinedForFirestore(raw), { merge: true });
}

export async function joinTournament(tournamentId: string, uid: string, displayName: string) {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  await setDoc(
    doc(fb.db, 'users', uid, 'joinedTournaments', tournamentId),
    stripUndefinedForFirestore({
      tournamentId,
      displayName,
      joinedAt: serverTimestamp(),
    })
  );
  await setDoc(
    doc(fb.db, 'tournaments', tournamentId, 'participants', uid),
    stripUndefinedForFirestore({ uid, displayName, joinedAt: serverTimestamp() }),
    { merge: true }
  );
}

export async function updateUserPresence(uid: string, online: boolean): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await updateDoc(doc(fb.db, 'users', uid), {
    online,
    lastSeen: serverTimestamp(),
  }).catch(() => {});
}

export function subscribeUserPresence(
  uid: string,
  onNext: (presence: { online: boolean; lastSeen?: number }) => void,
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
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
  const fb = ensureFirebase();
  if (!fb) return;
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

/** Update ownerPhotoUrl on all of the user's public catches — called after profile photo change. */
export async function refreshOwnerPhotoOnPublicCatches(uid: string, photoUrl: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  try {
    const snap = await getDocs(
      query(collection(fb.db, 'publicCatches'), where('ownerUid', '==', uid))
    );
    if (snap.empty) return;
    const CHUNK = 400; // Firestore batch limit is 500 ops
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const b = writeBatch(fb.db);
      snap.docs.slice(i, i + CHUNK).forEach((d) => {
        b.update(d.ref, { ownerPhotoUrl: photoUrl });
      });
      await b.commit();
    }
  } catch {
    // Best-effort — old posts missing the new photo is acceptable
  }
}
