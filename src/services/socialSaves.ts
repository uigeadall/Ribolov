import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowSaveToggle } from './socialRateLimit';
import { TtlMap } from './ttlCache';

// Saved-state cache: mirrors the my-reaction cache in socialReactions.ts.
// Each feed card used to hold a live onSnapshot on its saves doc — 20+
// active listeners per feed view for a value that only changes when THIS
// user taps save. One-shot getDoc + 5min TTL + write-through on toggle.
// Trade-off (same as reactions): a save made on another device won't show
// here until the TTL lapses or the feed refetches.
const SAVED_TTL_MS = 5 * 60 * 1000;
const _savedCache = new TtlMap<string, boolean>(SAVED_TTL_MS);
const savedKey = (myUid: string, catchId: string) => `${myUid}:${catchId}`;

export async function toggleSaveCatch(myUid: string, catchId: string): Promise<boolean> {
  if (!allowSaveToggle(myUid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = requireFirebase();
  const refDoc = doc(fb.db, 'users', myUid, 'savedCatches', catchId);
  const snap = await getDoc(refDoc);
  if (snap.exists()) {
    await deleteDoc(refDoc);
    _savedCache.set(savedKey(myUid, catchId), false);
    return false;
  }
  await setDoc(refDoc, stripUndefinedForFirestore({ catchId, savedAt: serverTimestamp() }));
  _savedCache.set(savedKey(myUid, catchId), true);
  return true;
}

/** Subscribe-shape API kept for source compatibility, but backed by a
    one-shot fetch + memory cache (see _savedCache note above). Returns a
    no-op unsubscribe when served from cache. */
export function subscribeCatchSaved(myUid: string, catchId: string, cb: (saved: boolean) => void): () => void {
  const key = savedKey(myUid, catchId);
  const cached = _savedCache.get(key);
  if (cached !== undefined) {
    cb(cached);
    return () => {};
  }
  let cancelled = false;
  void (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'users', myUid, 'savedCatches', catchId));
      _savedCache.set(key, snap.exists());
      if (!cancelled) cb(snap.exists());
    } catch {
      if (!cancelled) cb(false);
    }
  })();
  return () => { cancelled = true; };
}

/** Unsave several catches at once. Batched in groups of 400 (Firestore caps
    at 500; leave headroom). Used by SavedPostsScreen's multi-select mode.
    Best-effort: a partial failure leaves earlier deletes committed. */
export async function unsaveCatchesBulk(myUid: string, catchIds: string[]): Promise<void> {
  if (catchIds.length === 0) return;
  const fb = requireFirebase();
  const CHUNK = 400;
  for (let i = 0; i < catchIds.length; i += CHUNK) {
    const batch = writeBatch(fb.db);
    for (const id of catchIds.slice(i, i + CHUNK)) {
      batch.delete(doc(fb.db, 'users', myUid, 'savedCatches', id));
    }
    await batch.commit();
    for (const id of catchIds.slice(i, i + CHUNK)) {
      _savedCache.set(savedKey(myUid, id), false);
    }
  }
}

export function subscribeSavedCatchIdsOrdered(myUid: string, onNext: (ids: string[]) => void): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'users', myUid, 'savedCatches'),
    orderBy('savedAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => onNext(snap.docs.map((d) => d.id)),
    () => onNext([])
  );
}
