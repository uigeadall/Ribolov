import { doc, setDoc, deleteDoc, getDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { ensureFirebase } from './firebase';

export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await setDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid), {
    blockedAt: serverTimestamp(),
  });
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await deleteDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid));
}

export async function isBlockedBy(myUid: string, targetUid: string): Promise<boolean> {
  const fb = ensureFirebase();
  if (!fb) return false;
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid));
  return snap.exists();
}

export async function getBlockedUids(myUid: string): Promise<Set<string>> {
  const fb = ensureFirebase();
  if (!fb) return new Set();
  try {
    const snap = await getDocs(collection(fb.db, 'users', myUid, 'blockedUsers'));
    return new Set(snap.docs.map((d) => d.id));
  } catch {
    return new Set();
  }
}
