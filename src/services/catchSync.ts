import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  deleteField,
  startAfter,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { getCloudinaryUploadConfig, uploadImageToCloudinary } from './cloudinaryConfig';
import type { Catch } from '../types';

export type CloudCatch = Catch & {
  ownerUid: string;
  ownerName?: string;
  ownerPhotoUrl?: string;
  isPublic?: boolean;
  syncedAt?: unknown;
  likeCount?: number;
};

export type FeedItem = CloudCatch;

export type FeedPage = {
  items: CloudCatch[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
};

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
  const fb = requireFirebase();
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
  const fb = requireFirebase();
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

export async function fetchPublicFeed(
  maxItems = 20,
  afterDoc?: DocumentSnapshot | null
): Promise<FeedPage> {
  const fb = requireFirebase();
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

export async function fetchPublicCatchesByIds(ids: string[]): Promise<CloudCatch[]> {
  const fb = requireFirebase();
  if (ids.length === 0) return [];
  const uniq = [...new Set(ids)];
  const snaps = await Promise.all(uniq.map((id) => getDoc(doc(fb.db, 'publicCatches', id))));
  const byId = new Map<string, CloudCatch>();
  for (const s of snaps) {
    if (s.exists()) byId.set(s.id, s.data() as CloudCatch);
  }
  return uniq.map((id) => byId.get(id)).filter((c): c is CloudCatch => c != null);
}

export async function fetchPublicCatchesSince(minDateIso: string, maxCount = 2500): Promise<CloudCatch[]> {
  const fb = requireFirebase();
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
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'publicCatches'),
    where('ownerUid', '==', ownerUid),
    orderBy('date', 'desc'),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CloudCatch);
}

export async function refreshOwnerPhotoOnPublicCatches(uid: string, photoUrl: string): Promise<void> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(
      query(collection(fb.db, 'publicCatches'), where('ownerUid', '==', uid))
    );
    if (snap.empty) return;
    const CHUNK = 400;
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
