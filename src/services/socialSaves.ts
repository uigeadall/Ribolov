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
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

export async function toggleSaveCatch(myUid: string, catchId: string): Promise<boolean> {
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
