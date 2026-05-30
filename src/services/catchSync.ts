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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { getCloudinaryUploadConfig, uploadImageToCloudinary } from './cloudinaryConfig';
import { uploadImageToR2, uploadVideoToR2, deleteFromR2, isR2Url, r2KeyFromUrl } from './r2Upload';
import type { Catch } from '../types';

export type CloudCatch = Catch & {
  ownerUid: string;
  ownerName?: string;
  ownerPhotoUrl?: string;
  isPublic?: boolean;
  syncedAt?: unknown;
  likeCount?: number;
  /** Per-reaction-type tally maintained atomically by toggleCatchReaction.
      Lets FeedPost render the emoji breakdown without the per-card
      `fetchReactionSummary` round-trip (which read up to 50 docs per card).
      Optional because legacy catches created before this field existed
      don't have it — callers fall back to fetchReactionSummary in that case. */
  reactionCounts?: Partial<Record<'heart' | 'fire' | 'trophy' | 'fish' | 'wow', number>>;
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

export type UploadProgressFn = (fraction: number) => void;

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
      // R2 path: client-side resize-to-JPEG inside uploadImageToR2, then
      // direct PUT to a presigned URL. No resize-extension polling — the
      // re-encode happens locally before upload, so by the time the upload
      // returns the public CDN URL is immediately fetchable.
      const path = `publicCatchPhotos/${ownerUid}/${c.id}/${Date.now()}.jpg`;
      const { url, storagePath } = await uploadImageToR2(uri, path, reportProgress);
      uploadIdx += 1;
      reportProgress?.(0);
      updated = { ...updated, photoUri: url, photoStoragePath: storagePath };
    }
  }

  // Upload any extra photos that are still local file:// URIs. Same path as
  // the primary photo (R2 + client-side resize). Extras upload in parallel —
  // per-extra progress is omitted intentionally because a single linear bar
  // would interleave wildly across N concurrent uploads. We don't store
  // per-extra storage paths; deletion derives the key back from the URL via
  // `r2KeyFromUrl` (same trick the old code did with firebasestorage URLs).
  const extras = updated.extraPhotoUris;
  if (extras && extras.length > 0 && extras.some((u) => u && !isRemote(u))) {
    const uploadedExtras = await Promise.all(
      extras.map(async (extraUri, idx) => {
        if (!extraUri || isRemote(extraUri)) return extraUri;
        const path = `publicCatchPhotos/${ownerUid}/${c.id}/extra_${idx}_${Date.now()}.jpg`;
        const { url } = await uploadImageToR2(extraUri, path);
        uploadIdx += 1;
        reportProgress?.(0);
        return url;
      })
    );
    updated = { ...updated, extraPhotoUris: uploadedExtras };
  }

  // Video upload. Single per-catch, capped at 15s by the AddCatch picker.
  // R2 path matches the photos' namespace so deletion can sweep both with
  // one prefix scan. We don't transcode here — expo-image-picker already
  // hands back H.264/MP4 at 720p (iOS) or the native asset (Android), and
  // the inline player streams whatever arrives. videoStoragePath stays on
  // the doc so catch deletion can call deleteFromR2.
  const videoUri = updated.videoUri?.trim();
  if (videoUri && !isRemote(videoUri)) {
    const path = `publicCatchVideos/${ownerUid}/${c.id}/${Date.now()}.mp4`;
    const { url, storagePath } = await uploadVideoToR2(videoUri, path);
    updated = { ...updated, videoUri: url, videoStoragePath: storagePath };
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
    // Video fields — same deleteField pattern. Removing a video from a
    // catch (set videoUri undefined) should also drop the stored path so
    // a stale orphan doesn't keep streaming after the user "removed" it.
    videoUri: c.videoUri ?? deleteField(),
    videoStoragePath: c.videoStoragePath ?? deleteField(),
    videoDurationMs: c.videoDurationMs ?? deleteField(),
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
      // Seed both `likeCount` and `reactionCounts` on first write so the feed
      // can render the inline emoji breakdown with zero Firestore reads.
      // Without the empty-map seed, every brand-new catch falls back to the
      // legacy fetchReactionSummary path (50-doc read per card) until
      // someone reacts.
      const publicPayload = snap.exists()
        ? payload
        : { ...payload, likeCount: 0, reactionCounts: {} };
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

  // The just-published catch (or its inverse — a catch flipped to private)
  // changes the feed composition. Nuke the cached first page so the next
  // FeedScreen mount doesn't flash a stale "no-new-post" version before the
  // network fetch lands. Cheap (handful of AsyncStorage deletes); fire-and-
  // forget so a slow cache wipe doesn't block the caller.
  void invalidateAllFeedCaches();
}

/**
 * Best-effort delete of a stored media file. Skips Cloudinary paths
 * (Cloudinary manages its own lifecycle). For R2 paths, routes through the
 * `deleteR2Object` Cloud Function — the client can't delete directly because
 * we don't ship R2 credentials to the client.
 */
export async function deleteStoragePath(storagePath: string | undefined): Promise<void> {
  if (!storagePath || storagePath.startsWith(CLOUDINARY_PREFIX)) return;
  await deleteFromR2(storagePath);
}

/**
 * Best-effort delete given a media URL — used when we only have the URL
 * (not the storage path), e.g. extra-photo URLs on a catch doc. Recognises
 * R2 public URLs and routes them through the Cloud Function; skips anything
 * else silently.
 */
export async function deleteMediaByUrl(url: string | undefined): Promise<void> {
  const key = r2KeyFromUrl(url);
  if (key) await deleteFromR2(key);
}

/**
 * Permanently deletes a catch from everywhere: user's private doc, public feed doc,
 * and the photo file in R2. Use when the user deletes a catch from their logbook.
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
    await deleteFromR2(storagePath);
  }
  if (extraPhotoUris && extraPhotoUris.length > 0) {
    // Extras live in R2 under publicCatchPhotos — derive the key from the URL.
    for (const url of extraPhotoUris) {
      if (!isR2Url(url)) continue;
      const key = r2KeyFromUrl(url);
      if (key) await deleteFromR2(key);
    }
  }
  // A catch was deleted from publicCatches — the cached feed page may still
  // contain it. Invalidate so the next mount doesn't briefly render a "ghost"
  // entry that 404s on tap.
  void invalidateAllFeedCaches();
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

  // Delete the actual file from R2 (skip Cloudinary — it manages its own lifecycle)
  if (storagePath && !storagePath.startsWith(CLOUDINARY_PREFIX)) {
    await deleteFromR2(storagePath);
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
      const page = await _fetchPublicFeedImpl(maxItems, afterDoc, ownerUids);
      // Cache only the first-page items. Pagination cursors (DocumentSnapshot)
      // aren't serializable, and load-more pages aren't worth caching — the
      // hit rate is near-zero (users rarely re-scroll the same later page).
      if (!afterDoc) {
        void writeFirstPageCache(maxItems, ownerUids, page.items);
      }
      return page;
    } finally {
      _feedInflight.delete(key);
    }
  })();
  _feedInflight.set(key, p);
  return p;
}

// ── First-page AsyncStorage cache ────────────────────────────────────────────
// Stale-while-revalidate pattern: callers display `prefetchFirstPageItems()`
// synchronously on mount for instant paint, then await `fetchPublicFeed()`
// for the fresh page. The fresh fetch always runs and always overwrites the
// rendered list; the cache only buys the user the first ~300ms of perceived
// latency before the network result lands. At 10k DAU that's the difference
// between "app is fast" and "app feels sluggish on every cold open".

const FEED_CACHE_PREFIX = '@ribolov/feedCache:';
// Hard expiry — older than this, the cache is treated as missing. 24h means
// returning users always see SOMETHING, even after a day-long absence; longer
// risks showing meaningfully stale content (feed turns over hourly).
const FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function feedCacheKey(maxItems: number, ownerUids?: string[]): string {
  return `${FEED_CACHE_PREFIX}${maxItems}:${(ownerUids ?? []).sort().join(',')}`;
}

async function writeFirstPageCache(
  maxItems: number,
  ownerUids: string[] | undefined,
  items: CloudCatch[],
): Promise<void> {
  try {
    const payload = JSON.stringify({ items, at: Date.now() });
    await AsyncStorage.setItem(feedCacheKey(maxItems, ownerUids), payload);
  } catch {
    // Cache write failure is non-critical — next call just refills from network.
  }
}

/** Nuke every cached feed page. Call after writes that change the feed
    composition (new catch published, catch deleted, catch made private)
    so the next mount fetches fresh instead of flashing the stale cache.
    Iterates AsyncStorage keys — cheap because we only have a handful of
    cache entries (one per scope × ownerUid combination). */
export async function invalidateAllFeedCaches(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const feedKeys = allKeys.filter((k) => k.startsWith(FEED_CACHE_PREFIX));
    if (feedKeys.length > 0) await AsyncStorage.multiRemove(feedKeys);
  } catch {
    // Cache wipe failure is non-critical — the stale paint will eventually
    // expire on its own via FEED_CACHE_TTL_MS.
  }
}

/** Synchronous-feeling prefetch: returns the last-cached first-page items if
    fresh, or [] if missing/expired. Always resolves quickly — no network. */
export async function prefetchFirstPageItems(
  maxItems = 20,
  ownerUids?: string[],
): Promise<CloudCatch[]> {
  try {
    const raw = await AsyncStorage.getItem(feedCacheKey(maxItems, ownerUids));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: CloudCatch[]; at?: number };
    if (!parsed.at || Date.now() - parsed.at > FEED_CACHE_TTL_MS) return [];
    return parsed.items ?? [];
  } catch {
    return [];
  }
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
// The map renders cells, never raw points. Privacy invariants (enforced
// server-side in the `getSpeciesHeatmap` Cloud Function):
//   1. Coordinates are bucketed to ~5km cells; cell centers are never real
//      catch coords.
//   2. A cell only emits if it contains ≥3 distinct owner uids.
// Raw catch points never leave the backend on this path — guarantee is now
// architectural, not just convention.

export type HeatmapCell = {
  /** Cell-center coordinate (5km grid). Not a real catch location. */
  latitude: number;
  longitude: number;
  /** Number of distinct anglers contributing to this cell. ≥3. */
  ownerCount: number;
  /** Total catches in this cell. Useful for intensity. */
  catchCount: number;
};

export async function fetchSpeciesHeatmap(
  minDateIso: string,
  speciesName?: string,
): Promise<HeatmapCell[]> {
  // Aggregation + k-anonymity enforcement is now done server-side by the
  // `getSpeciesHeatmap` Cloud Function. Server caches results for 10min per
  // (species, day) bucket — so a busy map screen costs 1 read per call
  // instead of up to 2,500. The privacy invariants (5km cells, min 3
  // distinct owners per cell) are enforced server-side, byte-identical to
  // the previous client-side implementation.
  const fb = requireFirebase();
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fns = getFunctions(fb.app);
  const fn = httpsCallable<
    { minDateIso: string; speciesName?: string },
    { cells: HeatmapCell[] }
  >(fns, 'getSpeciesHeatmap');
  const res = await fn({ minDateIso, speciesName });
  return res.data.cells ?? [];
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
