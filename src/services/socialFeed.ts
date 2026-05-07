import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ensureFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowComment, allowLikeToggle } from './socialRateLimit';
import { getUserPushToken, sendPushNotification } from './pushNotifications';

export type FeedComment = {
  id: string;
  authorUid: string;
  authorName: string;
  text: string;
  createdAt?: unknown;
};

export type SocialNotification = {
  id: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment' | 'follow';
  catchId: string;
  preview?: string;
  read: boolean;
  createdAt?: unknown;
};

export type CatchLiker = { uid: string; displayName: string };

export function subscribeMyLikeOnCatch(catchId: string, myUid: string, cb: (liked: boolean) => void): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  return onSnapshot(doc(fb.db, 'publicCatches', catchId, 'likes', myUid), (snap) => cb(snap.exists()));
}

export async function fetchCatchLikeCount(catchId: string): Promise<number> {
  const fb = ensureFirebase();
  if (!fb) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'publicCatches', catchId, 'likes'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function fetchCatchCommentCount(catchId: string): Promise<number> {
  const fb = ensureFirebase();
  if (!fb) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'publicCatches', catchId, 'comments'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

async function notifyInteraction(opts: {
  recipientUid: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment';
  catchId: string;
  preview?: string;
}): Promise<void> {
  if (opts.recipientUid === opts.actorUid) return;
  const fb = ensureFirebase();
  if (!fb) return;
  await addDoc(
    collection(fb.db, 'users', opts.recipientUid, 'notifications'),
    stripUndefinedForFirestore({
      actorUid: opts.actorUid,
      actorName: opts.actorName.slice(0, 120),
      type: opts.type,
      catchId: opts.catchId,
      preview: (opts.preview ?? '').slice(0, 200),
      read: false,
      createdAt: serverTimestamp(),
    })
  );
  // Send device push notification (fire-and-forget)
  void getUserPushToken(opts.recipientUid).then((token) => {
    if (!token) return;
    const isLike = opts.type === 'like';
    sendPushNotification({
      to: token,
      title: opts.actorName,
      body: isLike ? 'Харесва твоя улов 🎣' : `Коментира: ${(opts.preview ?? '').slice(0, 80)}`,
      data: { type: opts.type, catchId: opts.catchId },
    });
  });
}

/** Връща true ако след операцията уловът е харесан. */
export async function toggleCatchLike(
  catchId: string,
  myUid: string,
  catchOwnerUid: string,
  actorName: string
): Promise<boolean> {
  if (!allowLikeToggle(myUid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const refLike = doc(fb.db, 'publicCatches', catchId, 'likes', myUid);
  const snap = await getDoc(refLike);
  if (snap.exists()) {
    await deleteDoc(refLike);
    return false;
  }
  await setDoc(
    refLike,
    stripUndefinedForFirestore({
      createdAt: serverTimestamp(),
      displayName: actorName.slice(0, 120),
    })
  );
  await notifyInteraction({
    recipientUid: catchOwnerUid,
    actorUid: myUid,
    actorName,
    type: 'like',
    catchId,
  });
  return true;
}

export function subscribeCatchComments(catchId: string, onNext: (comments: FeedComment[]) => void): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'publicCatches', catchId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(80)
  );
  return onSnapshot(q, (snap) => {
    onNext(
      snap.docs.map((d) => {
        const data = d.data() as { authorUid: string; authorName: string; text: string; createdAt?: unknown };
        return { id: d.id, ...data };
      })
    );
  });
}

export async function addCatchComment(
  catchId: string,
  authorUid: string,
  authorName: string,
  text: string,
  catchOwnerUid: string
): Promise<void> {
  if (!allowComment(authorUid)) {
    throw new Error('Твърде много коментари за кратко време. Опитай по-късно.');
  }
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(
    collection(fb.db, 'publicCatches', catchId, 'comments'),
    stripUndefinedForFirestore({
      authorUid,
      authorName,
      text: trimmed.slice(0, 2000),
      createdAt: serverTimestamp(),
    })
  );
  await notifyInteraction({
    recipientUid: catchOwnerUid,
    actorUid: authorUid,
    actorName: authorName,
    type: 'comment',
    catchId,
    preview: trimmed.slice(0, 120),
  });
}

export function subscribeMyNotifications(myUid: string, onNext: (items: SocialNotification[]) => void): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'users', myUid, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(80)
  );
  return onSnapshot(q, (snap) => {
    onNext(
      snap.docs.map((d) => {
        const data = d.data() as {
          actorUid: string;
          actorName: string;
          type: 'like' | 'comment' | 'follow';
          catchId: string;
          preview?: string;
          read?: boolean;
          createdAt?: unknown;
        };
        return {
          id: d.id,
          actorUid: data.actorUid,
          actorName: data.actorName,
          type: data.type,
          catchId: data.catchId,
          preview: data.preview,
          read: !!data.read,
          createdAt: data.createdAt,
        };
      })
    );
  });
}

export async function markNotificationRead(myUid: string, notifId: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await updateDoc(doc(fb.db, 'users', myUid, 'notifications', notifId), stripUndefinedForFirestore({ read: true }));
}

/** Известие за нов последовател (получателят е следваният профил). */
export async function sendFollowNotification(
  followedUid: string,
  followerUid: string,
  followerDisplayName: string
): Promise<void> {
  if (!followedUid || followedUid === followerUid) return;
  const fb = ensureFirebase();
  if (!fb) return;
  await addDoc(
    collection(fb.db, 'users', followedUid, 'notifications'),
    stripUndefinedForFirestore({
      actorUid: followerUid,
      actorName: followerDisplayName.slice(0, 120),
      type: 'follow',
      catchId: '',
      preview: '',
      read: false,
      createdAt: serverTimestamp(),
    })
  );
  void getUserPushToken(followedUid).then((token) => {
    if (!token) return;
    sendPushNotification({
      to: token,
      title: followerDisplayName,
      body: 'Започна да те следва 🎣',
      data: { type: 'follow', actorUid: followerUid },
    });
  });
}

export async function fetchCatchLikers(catchId: string): Promise<CatchLiker[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  try {
    const snap = await getDocs(query(collection(fb.db, 'publicCatches', catchId, 'likes'), limit(80)));
    return snap.docs.map((d) => {
      const data = d.data() as { displayName?: string };
      const name = typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim().slice(0, 120)
        : 'Рибар';
      return { uid: d.id, displayName: name };
    });
  } catch {
    return [];
  }
}

/** Връща true ако уловът е запазен след операцията. */
export async function toggleSaveCatch(myUid: string, catchId: string): Promise<boolean> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
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
  const fb = ensureFirebase();
  if (!fb) return () => {};
  return onSnapshot(doc(fb.db, 'users', myUid, 'savedCatches', catchId), (s) => cb(s.exists()));
}

/** Ред на catchId по дата на запазване (най-новите отгоре). */
export function subscribeSavedCatchIdsOrdered(myUid: string, onNext: (ids: string[]) => void): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
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
