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

const FOLLOWING_TTL_MS = 2 * 60 * 1000;
const followingCache = new Map<string, { data: { uid: string; displayName: string }[]; at: number }>();

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
  followingCache.delete(myUid);
}

export async function unfollowUser(myUid: string, targetUid: string) {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'users', myUid, 'following', targetUid));
  batch.delete(doc(fb.db, 'users', targetUid, 'followers', myUid));
  await batch.commit();
  followingCache.delete(myUid);
}

export async function getFollowing(myUid: string) {
  const cached = followingCache.get(myUid);
  if (cached && Date.now() - cached.at < FOLLOWING_TTL_MS) return cached.data;
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'users', myUid, 'following'));
  const data = snap.docs.map((d) => {
    const d2 = d.data() as { uid?: string; displayName?: string };
    return { uid: d.id, displayName: d2.displayName ?? '' };
  });
  followingCache.set(myUid, { data, at: Date.now() });
  return data;
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
