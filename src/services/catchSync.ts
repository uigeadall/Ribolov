import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  documentId,
  serverTimestamp,
  deleteField,
  startAfter,
  writeBatch,
  runTransaction,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { getIdToken } from 'firebase/auth';
import * as FileSystem from 'expo-file-system/legacy';
import { requireFirebase } from './firebase';
import { getFirebaseWebConfig } from './firebaseConfig';
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

const _ownerPhotoCache = new Map<string, { url: string; at: number }>();
const OWNER_PHOTO_TTL = 5 * 60 * 1000;
const _feedInflight = new Map<string, Promise<FeedPage>>();

async function fetchOwnerPhoto(
  fb: ReturnType<typeof requireFirebase>,
  uid: string,
): Promise<string> {
  const cached = _ownerPhotoCache.get(uid);
  if (cached && Date.now() - cached.at < OWNER_PHOTO_TTL) return cached.url;
  const snap = await getDoc(doc(fb.db, 'users', uid));
  const url =
    snap.exists() && typeof snap.data()?.photoUrl === 'string'
      ? String(snap.data()?.photoUrl).trim()
      : '';
  _ownerPhotoCache.set(uid, { url, at: Date.now() });
  return url;
}

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

/** Poll for the Resize Images extension's webp variant of an uploaded file.
    The extension typically completes in 1–3 seconds for normal-sized photos
    but can take longer on cold-start. 15 seconds is forgiving without
    blocking the save flow forever. Polls every 1.5s. */
export async function waitForResizedUrl(
  storage: ReturnType<typeof requireFirebase>['storage'],
  originalPath: string,
  suffix: string,
  maxWaitMs = 15_000,
): Promise<string | null> {
  const resizedPath = originalPath.replace(/\.[^.]+$/, `${suffix}.webp`);
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const url = await getDownloadURL(ref(storage, resizedPath));
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[catchSync] resize variant ready', { attempt, resizedPath });
      }
      return url;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

export type UploadProgressFn = (fraction: number) => void;

export async function uploadLocalPhotoToStorage(
  fb: ReturnType<typeof requireFirebase>,
  uri: string,
  storagePath: string,
  onProgress?: UploadProgressFn,
): Promise<string> {
  const extMatch = uri.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return withRetry(async () => {
    const currentUser = fb.auth.currentUser;
    if (!currentUser) throw new Error('Не сте влезли в профила');
    const token = await getIdToken(currentUser);
    const { storageBucket } = getFirebaseWebConfig();

    // Sanity-check the source file before uploading. If ImagePicker's temp
    // file has been cleaned up (a known Expo Go quirk between camera capture
    // and background sync), uploadAsync silently sends 0 bytes and the
    // "upload" returns 200 with empty metadata — which is exactly what we've
    // been seeing.
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error(`Source file missing: ${uri}`);
    }
    const fileSize = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    if (fileSize === 0) {
      throw new Error(`Source file is 0 bytes: ${uri}`);
    }

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[catchSync] uploading', {
        uri,
        bytes: fileSize,
        to: `${storageBucket}/${storagePath}`,
      });
    }

    // createUploadTask + onProgress drives the visible top progress bar in
    // AddCatchScreen / CreatePostScreen. With a no-op onProgress this behaves
    // identically to the previous uploadAsync call.
    const targetUrl =
      `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o` +
      `?uploadType=media&name=${encodeURIComponent(storagePath)}`;
    const uploadTask = FileSystem.createUploadTask(
      targetUrl,
      uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      },
      onProgress
        ? (p) => {
            const total = p.totalBytesExpectedToSend || fileSize || 1;
            const sent = p.totalBytesSent || 0;
            onProgress(Math.max(0, Math.min(1, sent / total)));
          }
        : undefined,
    );
    const result = await uploadTask.uploadAsync();
    if (!result) {
      throw new Error('Upload returned no result');
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Storage upload HTTP ${result.status}: ${result.body.slice(0, 200)}`);
    }

    // Verify the upload response — Firebase Storage returns JSON metadata
    // including `size`. If `size` is missing or 0, the upload "succeeded"
    // (HTTP 200) but didn't actually write the file body.
    let uploadedSize = 0;
    let uploadedName = '';
    try {
      const meta = JSON.parse(result.body) as { size?: string; name?: string };
      uploadedSize = parseInt(meta.size ?? '0', 10);
      uploadedName = meta.name ?? '';
    } catch {
      // Non-JSON response — log it so we can see what we got.
    }

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[catchSync] upload response', {
        status: result.status,
        uploadedSize,
        uploadedName,
        bodyPreview: result.body.slice(0, 400),
      });
    }

    if (uploadedSize === 0 || !uploadedName) {
      throw new Error(
        `Firebase Storage upload reported 0-byte file. Response: ${result.body.slice(0, 200)}`,
      );
    }

    // Build the download URL using the actual bucket the upload response
    // reported (firebaseStorageBucket from config) — uploads land in that
    // bucket, downloads must use the same.
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}` +
      `/o/${encodeURIComponent(uploadedName)}?alt=media`;
    return url;
  });
}

export async function ensureCatchPhotoUploadedForCloud(
  c: Catch,
  ownerUid: string,
  onProgress?: UploadProgressFn,
): Promise<Catch> {
  const uri = c.photoUri?.trim();
  const cloud = getCloudinaryUploadConfig();
  let updated = { ...c };

  // Count how many uploads we'll actually do so we can map per-upload fraction
  // to overall fraction. Primary photo (1) + non-remote extras.
  const extraLocalsCount = (c.extraPhotoUris ?? []).filter((u) => u && !isRemote(u)).length;
  const totalUploads = (uri && !isRemote(uri) ? 1 : 0) + extraLocalsCount;
  let uploadIdx = 0;
  const reportProgress = onProgress
    ? (perUpload: number) => onProgress((uploadIdx + perUpload) / Math.max(1, totalUploads))
    : undefined;

  if (uri && !isRemote(uri)) {
    if (cloud) {
      const { secureUrl, publicId } = await withRetry(() =>
        uploadImageToCloudinary(uri, cloud.cloudName, cloud.uploadPreset)
      );
      updated = { ...updated, photoUri: secureUrl, photoStoragePath: `${CLOUDINARY_PREFIX}${publicId}` };
      uploadIdx += 1;
      reportProgress?.(0);
    } else {
      const fb = requireFirebase();
      const extMatch = uri.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const path = `publicCatchPhotos/${ownerUid}/${c.id}/${Date.now()}.${ext}`;
      const url = await uploadLocalPhotoToStorage(fb, uri, path, reportProgress);
      uploadIdx += 1;
      reportProgress?.(0);
      // This project has Firebase's "Resize Images" extension installed, which
      // creates a `_1200x1200.webp` variant on every upload AND deletes the
      // original by default. The variant is written via Admin SDK so it gets
      // a proper `firebaseStorageDownloadTokens` metadata field — which means
      // its `getDownloadURL` returns a tokenized URL that works for anonymous
      // fetchers (the original URL we built does not, since raw POST uploads
      // can't generate that token). Wait for the variant, use it as photoUri.
      const resizedUrl = await waitForResizedUrl(fb.storage, path, '_1200x1200');
      if (__DEV__) {
        if (resizedUrl) {
          // eslint-disable-next-line no-console
          console.log('[catchSync] using resized variant', { resizedUrl: resizedUrl.slice(0, 120) });
        } else {
          // eslint-disable-next-line no-console
          console.warn('[catchSync] resize variant not ready after 15s, falling back to original (may 404 if extension deletes originals)');
        }
      }
      updated = { ...updated, photoUri: resizedUrl ?? url, photoStoragePath: path };
    }
  }

  // Upload any extra photos that are still local file:// URIs.
  // Mirror the primary-photo path: raw POST upload to Storage, then wait for
  // the Resize Images extension's _1200x1200.webp variant and use its URL.
  // The raw POST URL doesn't have the firebaseStorageDownloadTokens metadata
  // that anonymous fetchers (expo-image in the feed) need, AND the extension
  // deletes the original after resizing — so the previous code stored URLs
  // that 404'd for everyone, making the 2nd/3rd/4th carousel slides appear
  // blank.
  const extras = updated.extraPhotoUris;
  if (extras && extras.length > 0 && extras.some((u) => u && !isRemote(u))) {
    const fb = requireFirebase();
    // Per-extra progress is omitted intentionally — extras upload in parallel,
    // so a single linear bar would interleave wildly. We just bump the
    // overall index by 1 as each extra finishes so the bar still climbs.
    const uploadedExtras = await Promise.all(
      extras.map(async (extraUri, idx) => {
        if (!extraUri || isRemote(extraUri)) return extraUri;
        const extMatch = extraUri.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const path = `publicCatchPhotos/${ownerUid}/${c.id}/extra_${idx}_${Date.now()}.${ext}`;
        const url = await uploadLocalPhotoToStorage(fb, extraUri, path);
        const resizedUrl = await waitForResizedUrl(fb.storage, path, '_1200x1200');
        uploadIdx += 1;
        reportProgress?.(0);
        return resizedUrl ?? url;
      })
    );
    updated = { ...updated, extraPhotoUris: uploadedExtras };
  }

  onProgress?.(1);
  return updated;
}

export async function pushCatch(c: Catch, ownerUid: string, ownerName: string, isPublic: boolean) {
  const fb = requireFirebase();
  const rawPhoto = await fetchOwnerPhoto(fb, ownerUid);
  // Firestore rules require ownerPhotoUrl, if present, to be an https URL
  // (publicCatches CREATE in firestore.rules). A data: URL or file:// path
  // — possible if the auth provider returned a non-https photoURL, or the
  // in-app composer cached a base64 data URI — would otherwise reject the
  // whole publicCatches write with "Missing or insufficient permissions".
  // Drop the field entirely when the value isn't a clean https URL.
  const isCleanHttps = /^https:\/\//i.test(rawPhoto);
  const ownerPhotoPatch =
    isCleanHttps ? { ownerPhotoUrl: rawPhoto } : { ownerPhotoUrl: deleteField() };
  const rawPayload: Record<string, unknown> = {
    ...c,
    syncedToCloud: true,
    ownerUid,
    ownerName,
    isPublic: !!isPublic,
    syncedAt: serverTimestamp(),
    ...ownerPhotoPatch,
    // deleteField() ensures these are removed from Firestore when absent, not left stale by merge:true
    photoUri: c.photoUri ?? deleteField(),
    photoStoragePath: c.photoStoragePath ?? deleteField(),
    photoTitle: c.photoTitle ?? deleteField(),
    extraPhotoUris: c.extraPhotoUris ?? deleteField(),
  };
  const payload = stripUndefinedForFirestore(rawPayload);
  await setDoc(doc(fb.db, 'users', ownerUid, 'catches', c.id), payload, { merge: true });
  if (isPublic) {
    // Atomic read+conditional-write for the likeCount seed. The previous
    // getDoc-then-setDoc shape had a race: two concurrent flushes of the
    // same catch could both observe "doesn't exist" and both write
    // `likeCount: 0`, wiping any reactions accumulated between the reads.
    // Wrapping in runTransaction makes the existence check and the seeded
    // write a single Firestore commit — if the doc starts existing during
    // the txn, Firestore retries automatically and the second pass sees
    // the live counter.
    const publicRef = doc(fb.db, 'publicCatches', c.id);
    await runTransaction(fb.db, async (txn) => {
      const snap = await txn.get(publicRef);
      const publicPayload = snap.exists()
        ? payload
        : { ...payload, likeCount: 0 };
      txn.set(publicRef, publicPayload, { merge: true });
    });
  } else {
    // Remove from public feed if the catch was previously shared. Let the
    // error propagate — the caller is normally a sync-queue flush which has
    // its own retry/backoff, and previously swallowing the rejection meant
    // toggling a catch from public→private could silently fail (catch stays
    // visible in everyone's feed forever).
    try {
      await deleteDoc(doc(fb.db, 'publicCatches', c.id));
    } catch (e: unknown) {
      // not-found is fine — the catch was already private. Anything else
      // surfaces so the queue retries.
      const code = (e && typeof e === 'object' && 'code' in e) ? String((e as { code: unknown }).code) : '';
      if (code !== 'not-found') throw e;
    }
  }
}

/**
 * Best-effort delete of a Firebase Storage file. Skips Cloudinary paths.
 */
export async function deleteStoragePath(storagePath: string | undefined): Promise<void> {
  if (!storagePath || storagePath.startsWith(CLOUDINARY_PREFIX)) return;
  const fb = requireFirebase();
  await deleteObject(ref(fb.storage, storagePath)).catch(() => {});
}

/**
 * Permanently deletes a catch from everywhere: user's private doc, public feed doc,
 * and the photo file in Storage. Use when the user deletes a catch from their logbook.
 */
export async function deleteCatchEverywhere(catchId: string, ownerUid: string): Promise<void> {
  const fb = requireFirebase();

  // Read storage path + extra photos before deleting the doc
  let storagePath: string | undefined;
  let extraPhotoUris: string[] | undefined;
  try {
    const snap = await getDoc(doc(fb.db, 'users', ownerUid, 'catches', catchId));
    if (snap.exists()) {
      const data = snap.data() as { photoStoragePath?: string; extraPhotoUris?: string[] };
      storagePath = data.photoStoragePath;
      extraPhotoUris = data.extraPhotoUris;
    }
  } catch { /* ignore */ }

  await Promise.all([
    deleteDoc(doc(fb.db, 'users', ownerUid, 'catches', catchId)).catch(() => {}),
    deleteDoc(doc(fb.db, 'publicCatches', catchId)).catch(() => {}),
  ]);

  if (storagePath && !storagePath.startsWith(CLOUDINARY_PREFIX)) {
    await deleteObject(ref(fb.storage, storagePath)).catch(() => {});
  }
  if (extraPhotoUris && extraPhotoUris.length > 0) {
    // Extra photos may live in Storage under publicCatchPhotos — try to derive path from URL
    for (const url of extraPhotoUris) {
      if (!url || !url.includes('firebasestorage.googleapis.com')) continue;
      try {
        const m = decodeURIComponent(url).match(/\/o\/([^?]+)/);
        if (m?.[1]) await deleteObject(ref(fb.storage, m[1])).catch(() => {});
      } catch { /* ignore */ }
    }
  }
}

export async function removeFromPublicFeed(catchId: string, ownerUid: string): Promise<void> {
  const fb = requireFirebase();
  // Order matters. If we did these in parallel and the public-feed delete
  // failed while the isPublic:false write succeeded, the user's logbook would
  // claim the catch is private while it remained publicly visible. Run the
  // public delete first; only mark private locally once it's actually gone.
  try {
    await deleteDoc(doc(fb.db, 'publicCatches', catchId));
  } catch (e: unknown) {
    const code = (e && typeof e === 'object' && 'code' in e) ? String((e as { code: unknown }).code) : '';
    if (code !== 'not-found') throw e;
  }
  await setDoc(doc(fb.db, 'users', ownerUid, 'catches', catchId), { isPublic: false }, { merge: true });
}

export async function deletePhotoFromFeedPost(catchId: string, ownerUid: string): Promise<void> {
  const fb = requireFirebase();

  // Read storage path before clearing so we can delete the file
  const snap = await getDoc(doc(fb.db, 'publicCatches', catchId));
  const storagePath = snap.exists() ? (snap.data()?.photoStoragePath as string | undefined) : undefined;

  const photoFields = {
    photoUri: deleteField(),
    photoStoragePath: deleteField(),
    photoTitle: deleteField(),
    extraPhotoUris: deleteField(),
  };
  await Promise.all([
    setDoc(doc(fb.db, 'publicCatches', catchId), photoFields, { merge: true }),
    setDoc(doc(fb.db, 'users', ownerUid, 'catches', catchId), photoFields, { merge: true }),
  ]);

  // Delete the actual file from Storage (skip Cloudinary — it manages its own lifecycle)
  if (storagePath && !storagePath.startsWith('cloudinary:')) {
    await deleteObject(ref(fb.storage, storagePath)).catch(() => {});
  }
}

export async function fetchPublicFeed(
  maxItems = 20,
  afterDoc?: DocumentSnapshot | null,
  ownerUids?: string[]
): Promise<FeedPage> {
  const key = `${maxItems}:${afterDoc?.id ?? ''}:${(ownerUids ?? []).sort().join(',')}`;
  const inflight = _feedInflight.get(key);
  if (inflight) return inflight;
  // Build the inflight promise so the cache cleanup runs inside the same chain
  // that callers await. The earlier `p.finally(() => ...)` discarded a new
  // promise — when the impl rejected, that orphan promise raised an
  // "unhandled promise rejection" on every failed feed fetch.
  const p = (async () => {
    try {
      return await _fetchPublicFeedImpl(maxItems, afterDoc, ownerUids);
    } finally {
      _feedInflight.delete(key);
    }
  })();
  _feedInflight.set(key, p);
  return p;
}

async function _fetchPublicFeedImpl(
  maxItems = 20,
  afterDoc?: DocumentSnapshot | null,
  ownerUids?: string[]
): Promise<FeedPage> {
  const fb = requireFirebase();

  // Firestore 'in' operator is limited to 30 values — chunk when the list is
  // larger. Fire the chunks in parallel via Promise.all (was serial before).
  // For a power user with 200 follows that's ~7 chunks running concurrently
  // instead of sequentially — ~5× wall-time speedup on first feed load.
  if (ownerUids && ownerUids.length > 30) {
    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < ownerUids.length; i += CHUNK) {
      chunks.push(ownerUids.slice(i, i + CHUNK));
    }
    // When paginating, use the cursor doc's `date` as an INCLUSIVE upper
    // bound and dedupe by id. A strict `<` bound would silently drop any
    // catches that share the cursor's date string (date is stored to second
    // precision, so collisions are rare but real). Using `<=` plus id-dedupe
    // means same-date items just past the cursor still come through.
    const afterDate = (afterDoc?.data() as { date?: string } | undefined)?.date;
    const afterId = afterDoc?.id;
    const snaps = await Promise.all(
      chunks.map((chunk) => {
        const constraints: Parameters<typeof query>[1][] = [
          where('ownerUid', 'in', chunk),
          orderBy('date', 'desc'),
          limit(maxItems + 1),
        ];
        if (afterDate) constraints.splice(1, 0, where('date', '<=', afterDate));
        return getDocs(query(collection(fb.db, 'publicCatches'), ...constraints));
      }),
    );
    const all: { item: CloudCatch; snap: DocumentSnapshot }[] = [];
    const seenIds = new Set<string>();
    if (afterId) seenIds.add(afterId);
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        all.push({ item: d.data() as CloudCatch, snap: d });
      }
    }
    all.sort((a, b) => (b.item.date ?? '').localeCompare(a.item.date ?? ''));
    const hasMore = all.length > maxItems;
    const sliced = all.slice(0, maxItems);
    const lastSnap = sliced[sliced.length - 1]?.snap ?? null;
    return {
      items: sliced.map((s) => s.item),
      lastDoc: lastSnap,
      hasMore,
    };
  }

  const constraints: Parameters<typeof query>[1][] = [
    orderBy('date', 'desc'),
    limit(maxItems + 1),
  ];
  if (ownerUids && ownerUids.length > 0) constraints.unshift(where('ownerUid', 'in', ownerUids));
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
  const CHUNK = 10;
  const results: CloudCatch[] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const snap = await getDocs(
      query(collection(fb.db, 'publicCatches'), where(documentId(), 'in', chunk)),
    );
    snap.docs.forEach((d) => results.push(d.data() as CloudCatch));
  }
  const byId = new Map(results.map((c) => [c.id, c]));
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

// ─── Privacy-aware species heatmap ────────────────────────────────────────────
// The map renders cells, never raw points. Two privacy invariants:
//   1. Coordinates are bucketed to ~5km cells (0.05° lat/lon), so the displayed
//      centroid is never a real catch location — it's a cell center.
//   2. A cell only emits if it contains at least 3 *distinct* owner uids.
//      A single angler logging 10 catches at one spot would never show up;
//      neither would two anglers' personal-spot reveal. Both conditions can be
//      tuned via HEATMAP_CELL_DEG and HEATMAP_MIN_DISTINCT_OWNERS.
//
// We aggregate client-side from publicCatches. A server-side Cloud Function
// would be stronger (raw points never leave the backend) — that's left as a
// follow-up. For now the guarantee is: this function NEVER returns a raw
// CloudCatch, only HeatmapCell aggregates.
const HEATMAP_CELL_DEG = 0.05;
const HEATMAP_MIN_DISTINCT_OWNERS = 3;

export type HeatmapCell = {
  /** Cell-center coordinate (HEATMAP_CELL_DEG grid). Not a real catch location. */
  latitude: number;
  longitude: number;
  /** Number of distinct anglers contributing to this cell. ≥ HEATMAP_MIN_DISTINCT_OWNERS. */
  ownerCount: number;
  /** Total catches in this cell. Useful for intensity. */
  catchCount: number;
};

export async function fetchSpeciesHeatmap(
  minDateIso: string,
  speciesName?: string,
  maxCount = 2500,
): Promise<HeatmapCell[]> {
  const fb = requireFirebase();
  const constraints = [
    where('date', '>=', minDateIso),
    orderBy('date', 'desc'),
    limit(maxCount),
  ];
  const snap = await getDocs(query(collection(fb.db, 'publicCatches'), ...constraints));

  // Bucket each catch into a cell. Track distinct owner uids per cell to
  // enforce the k-anonymity threshold below.
  type Bucket = { lat: number; lng: number; owners: Set<string>; catches: number };
  const buckets = new Map<string, Bucket>();

  for (const d of snap.docs) {
    const c = d.data() as CloudCatch;
    if (!c.location?.latitude || !c.location?.longitude || !c.ownerUid) continue;
    if (speciesName && c.speciesName !== speciesName) continue;

    // Snap to grid. Math.floor on a signed-deg axis is fine — same sign on both ends.
    const row = Math.floor(c.location.latitude / HEATMAP_CELL_DEG);
    const col = Math.floor(c.location.longitude / HEATMAP_CELL_DEG);
    const key = `${row}:${col}`;
    let b = buckets.get(key);
    if (!b) {
      // Cell center (grid-snapped) — NOT the catch's real coords.
      b = {
        lat: (row + 0.5) * HEATMAP_CELL_DEG,
        lng: (col + 0.5) * HEATMAP_CELL_DEG,
        owners: new Set(),
        catches: 0,
      };
      buckets.set(key, b);
    }
    b.owners.add(c.ownerUid);
    b.catches += 1;
  }

  // Emit only cells that meet the distinct-owner threshold. This is the
  // privacy guarantee: a single angler's spots can never leak through this
  // path no matter how many catches they have there.
  const cells: HeatmapCell[] = [];
  for (const b of buckets.values()) {
    if (b.owners.size < HEATMAP_MIN_DISTINCT_OWNERS) continue;
    cells.push({
      latitude: b.lat,
      longitude: b.lng,
      ownerCount: b.owners.size,
      catchCount: b.catches,
    });
  }
  return cells;
}

export async function refreshOwnerPhotoOnPublicCatches(uid: string, photoUrl: string): Promise<void> {
  _ownerPhotoCache.set(uid, { url: photoUrl, at: Date.now() });
  const fb = requireFirebase();
  try {
    const snap = await getDocs(
      query(collection(fb.db, 'publicCatches'), where('ownerUid', '==', uid), limit(500))
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
