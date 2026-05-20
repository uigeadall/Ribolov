import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

/** Hashtags the user has followed. Stored under users/{uid}/followedHashtags/{tag}
    where `tag` is the lowercase, leading-#-stripped form (same shape used on
    Post.hashtags). The doc body just carries createdAt so we can later sort by
    recency if we want a "recently followed" UI. */

function normalize(tag: string): string {
  return tag.replace(/^#/, '').trim().toLowerCase();
}

export async function followHashtag(myUid: string, tag: string): Promise<void> {
  const t = normalize(tag);
  if (!myUid || !t) return;
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'users', myUid, 'followedHashtags', t),
    stripUndefinedForFirestore({ tag: t, createdAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function unfollowHashtag(myUid: string, tag: string): Promise<void> {
  const t = normalize(tag);
  if (!myUid || !t) return;
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'users', myUid, 'followedHashtags', t));
}

export async function isHashtagFollowed(myUid: string, tag: string): Promise<boolean> {
  const t = normalize(tag);
  if (!myUid || !t) return false;
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'followedHashtags', t));
  return snap.exists();
}

/** Fetches the full set of tags this user follows. Cheap — followed-hashtag
    counts in the dozens, not thousands. */
export async function listFollowedHashtags(myUid: string): Promise<string[]> {
  if (!myUid) return [];
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'users', myUid, 'followedHashtags'));
  return snap.docs.map((d) => d.id);
}

export function subscribeHashtagFollowed(
  myUid: string,
  tag: string,
  cb: (followed: boolean) => void,
): () => void {
  const t = normalize(tag);
  const fb = requireFirebase();
  return onSnapshot(
    doc(fb.db, 'users', myUid, 'followedHashtags', t),
    (snap) => cb(snap.exists()),
    // On permission/network error, fall through to "not followed" so the
    // Follow button stays clickable rather than freezing in a stale state.
    () => cb(false),
  );
}
