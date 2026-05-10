import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

export async function getFollowerCount(targetUid: string): Promise<number> {
  const fb = requireFirebase();
  if (!targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'followers'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function getFollowingCount(targetUid: string): Promise<number> {
  const fb = requireFirebase();
  if (!targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'following'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function isFollowingUser(myUid: string, targetUid: string): Promise<boolean> {
  const fb = requireFirebase();
  if (!myUid || !targetUid) return false;
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'following', targetUid));
  return snap.exists();
}

export async function followUser(myUid: string, targetUid: string, targetName?: string) {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.set(
    doc(fb.db, 'users', myUid, 'following', targetUid),
    stripUndefinedForFirestore({ uid: targetUid, displayName: targetName ?? '', createdAt: serverTimestamp() }),
  );
  batch.set(
    doc(fb.db, 'users', targetUid, 'followers', myUid),
    stripUndefinedForFirestore({ uid: myUid, createdAt: serverTimestamp() }),
  );
  await batch.commit();
}

export async function unfollowUser(myUid: string, targetUid: string) {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'users', myUid, 'following', targetUid));
  batch.delete(doc(fb.db, 'users', targetUid, 'followers', myUid));
  await batch.commit();
}

export async function getFollowing(myUid: string) {
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'users', myUid, 'following'));
  return snap.docs.map((d) => {
    const data = d.data() as { uid?: string; displayName?: string };
    return { uid: d.id, displayName: data.displayName ?? '' };
  });
}

export async function isMutualFollow(myUid: string, otherUid: string): Promise<boolean> {
  const fb = requireFirebase();
  if (!myUid || !otherUid || myUid === otherUid) return false;
  const [mine, theirs] = await Promise.all([
    getDoc(doc(fb.db, 'users', myUid, 'following', otherUid)),
    getDoc(doc(fb.db, 'users', otherUid, 'following', myUid)),
  ]);
  return mine.exists() && theirs.exists();
}
