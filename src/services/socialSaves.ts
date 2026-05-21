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

export async function toggleSaveCatch(myUid: string, catchId: string): Promise<boolean> {
  if (!allowSaveToggle(myUid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = requireFirebase();
  const refDoc = doc(fb.db, 'users', myUid, 'savedCatches', catchId);
  const snap = await getDoc(refDoc);
  if (snap.exists()) {
    await deleteDoc(refDoc);
    return false;
  }
  await setDoc(refDoc, stripUndefinedForFirestore({ catchId, savedAt: serverTimestamp() }));
  return true;
}

export function subscribeCatchSaved(myUid: string, catchId: string, cb: (saved: boolean) => void): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, 'users', myUid, 'savedCatches', catchId), (s) => cb(s.exists()));
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
