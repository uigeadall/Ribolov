import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowComment, allowLikeToggle } from './socialRateLimit';
import { getUserPushToken, sendPushNotification } from './pushNotifications';

export type ReactionType = 'heart' | 'fire' | 'trophy' | 'fish' | 'wow';

export const REACTIONS: Record<ReactionType, { emoji: string; label: string }> = {
  heart:  { emoji: '❤️', label: 'Харесвам' },
  fire:   { emoji: '🔥', label: 'Огън' },
  trophy: { emoji: '🏆', label: 'Трофей' },
  fish:   { emoji: '🎣', label: 'Улов' },
  wow:    { emoji: '😮', label: 'Уау' },
};

export type ReactionSummaryItem = { type: ReactionType; emoji: string; count: number };

export type FeedComment = {
  id: string;
  authorUid: string;
  authorName: string;
  text: string;
  createdAt?: unknown;
  editedAt?: unknown;
  replyToId?: string;
  replyToName?: string;
};

export type SocialNotification = {
  id: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment' | 'follow' | 'storyLike' | 'storyComment';
  catchId?: string;
  storyId?: string;
  preview?: string;
  reactionEmoji?: string;
  read: boolean;
  createdAt?: unknown;
};

export type CatchLiker = { uid: string; displayName: string; reaction?: ReactionType };

/** Subscribe to the current user's reaction on a catch (null = no reaction). */
export function subscribeMyReactionOnCatch(
  catchId: string,
  myUid: string,
  cb: (reaction: ReactionType | null) => void
): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, 'publicCatches', catchId, 'likes', myUid), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    const r = snap.data()?.reaction as ReactionType | undefined;
    cb(r ?? 'heart');
  });
}

/** @deprecated use subscribeMyReactionOnCatch */
export function subscribeMyLikeOnCatch(catchId: string, myUid: string, cb: (liked: boolean) => void): () => void {
  return subscribeMyReactionOnCatch(catchId, myUid, (r) => cb(r !== null));
}

export async function fetchCatchLikeCount(catchId: string): Promise<number> {
  const fb = requireFirebase();
  try {
    const agg = await getCountFromServer(collection(fb.db, 'publicCatches', catchId, 'likes'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function fetchCatchCommentCount(catchId: string): Promise<number> {
  const fb = requireFirebase();
  try {
    const agg = await getCountFromServer(collection(fb.db, 'publicCatches', catchId, 'comments'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

/** Returns top reactions with counts, sorted by count descending. */
export async function fetchReactionSummary(catchId: string): Promise<ReactionSummaryItem[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(query(collection(fb.db, 'publicCatches', catchId, 'likes'), limit(50)));
    const counts = new Map<ReactionType, number>();
    snap.docs.forEach((d) => {
      const r: ReactionType = (d.data().reaction as ReactionType) ?? 'heart';
      counts.set(r, (counts.get(r) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([type, count]) => ({ type, emoji: REACTIONS[type].emoji, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function notifyInteraction(opts: {
  recipientUid: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment';
  catchId: string;
  preview?: string;
  reactionEmoji?: string;
}): Promise<void> {
  if (opts.recipientUid === opts.actorUid) return;
  if (!opts.recipientUid || !opts.actorUid) return;
  const fb = requireFirebase();
  const safeName = (opts.actorName || 'Рибар').trim().slice(0, 120) || 'Рибар';
  const payload = {
    actorUid: opts.actorUid,
    actorName: safeName,
    type: opts.type,
    catchId: opts.catchId ?? '',
    preview: (opts.preview ?? '').slice(0, 200),
    ...(opts.reactionEmoji ? { reactionEmoji: opts.reactionEmoji } : {}),
    read: false,
    createdAt: serverTimestamp(),
  };
  if (opts.type === 'like') {
    // Deterministic ID — prevents a second notification when the user unlikes then re-likes
    await setDoc(
      doc(fb.db, 'users', opts.recipientUid, 'notifications', `like_${opts.actorUid}_${opts.catchId}`),
      payload
    );
  } else {
    // Comments are unique events — each one deserves its own notification
    await addDoc(collection(fb.db, 'users', opts.recipientUid, 'notifications'), payload);
  }
  void getUserPushToken(opts.recipientUid).then(async (token) => {
    if (!token) return;
    const isLike = opts.type === 'like';
    const emoji = opts.reactionEmoji ?? '❤️';
    await sendPushNotification({
      to: token,
      title: opts.actorName,
      body: isLike
        ? `Реагира ${emoji} на твоя улов`
        : `Коментира: ${(opts.preview ?? '').slice(0, 80)}`,
      data: { type: opts.type, catchId: opts.catchId, actorUid: opts.actorUid, actorName: opts.actorName },
    });
  }).catch(() => {});
}

/** Toggle or change a reaction. Pass null to remove. Returns the active reaction or null. */
export async function toggleCatchReaction(
  catchId: string,
  myUid: string,
  catchOwnerUid: string,
  actorName: string,
  reaction: ReactionType
): Promise<ReactionType | null> {
  if (!allowLikeToggle(myUid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = requireFirebase();
  const refLike = doc(fb.db, 'publicCatches', catchId, 'likes', myUid);
  const snap = await getDoc(refLike);
  const catchRef = doc(fb.db, 'publicCatches', catchId);
  // If same reaction already active — remove it
  if (snap.exists() && (snap.data()?.reaction ?? 'heart') === reaction) {
    await deleteDoc(refLike);
    updateDoc(catchRef, { likeCount: increment(-1) }).catch(() => {});
    return null;
  }
  await setDoc(
    refLike,
    stripUndefinedForFirestore({
      createdAt: serverTimestamp(),
      displayName: actorName.slice(0, 120),
      reaction,
    })
  );
  if (!snap.exists()) {
    updateDoc(catchRef, { likeCount: increment(1) }).catch(() => {});
    // Only notify on first reaction, not on reaction change — fire-and-forget
    notifyInteraction({
      recipientUid: catchOwnerUid,
      actorUid: myUid,
      actorName: (actorName || 'Рибар').slice(0, 120),
      type: 'like',
      catchId,
      reactionEmoji: REACTIONS[reaction].emoji,
    }).catch(() => {});
  }
  return reaction;
}

/** @deprecated use toggleCatchReaction */
export async function toggleCatchLike(
  catchId: string,
  myUid: string,
  catchOwnerUid: string,
  actorName: string
): Promise<boolean> {
  const r = await toggleCatchReaction(catchId, myUid, catchOwnerUid, actorName, 'heart');
  return r !== null;
}

/** Batch-check which of the given catchIds the user has already liked. */
export async function getMyLikedCatchIds(uid: string, catchIds: string[]): Promise<Set<string>> {
  if (!catchIds.length) return new Set();
  const fb = requireFirebase();
  const snaps = await Promise.all(
    catchIds.map((id) => getDoc(doc(fb.db, 'publicCatches', id, 'likes', uid)))
  );
  const liked = new Set<string>();
  snaps.forEach((snap, i) => { if (snap.exists()) liked.add(catchIds[i]); });
  return liked;
}

export function subscribeCatchComments(catchId: string, onNext: (comments: FeedComment[]) => void): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'publicCatches', catchId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(80)
  );
  return onSnapshot(q, (snap) => {
    onNext(
      snap.docs.map((d) => {
        const data = d.data() as {
          authorUid: string;
          authorName: string;
          text: string;
          createdAt?: unknown;
          replyToId?: string;
          replyToName?: string;
        };
        return {
          id: d.id,
          authorUid: data.authorUid,
          authorName: data.authorName,
          text: data.text,
          createdAt: data.createdAt,
          editedAt: (data as { editedAt?: unknown }).editedAt,
          replyToId: data.replyToId,
          replyToName: data.replyToName,
        };
      })
    );
  });
}

export async function addCatchComment(
  catchId: string,
  authorUid: string,
  authorName: string,
  text: string,
  catchOwnerUid: string,
  replyTo?: { id: string; name: string }
): Promise<void> {
  if (!allowComment(authorUid)) {
    throw new Error('Твърде много коментари за кратко време. Опитай по-късно.');
  }
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(
    collection(fb.db, 'publicCatches', catchId, 'comments'),
    stripUndefinedForFirestore({
      authorUid,
      authorName: authorName || 'Рибар',
      text: trimmed.slice(0, 2000),
      createdAt: serverTimestamp(),
      ...(replyTo ? { replyToId: replyTo.id, replyToName: replyTo.name } : {}),
    })
  );
  // Notification is fire-and-forget — never block or surface errors to the user
  notifyInteraction({
    recipientUid: catchOwnerUid,
    actorUid: authorUid,
    actorName: (authorName || 'Рибар').slice(0, 120),
    type: 'comment',
    catchId,
    preview: trimmed.slice(0, 120),
  }).catch(() => {});
}

export async function editCatchComment(catchId: string, commentId: string, newText: string): Promise<void> {
  const fb = requireFirebase();
  const trimmed = newText.trim();
  if (!trimmed) throw new Error('Текстът не може да е празен.');
  await updateDoc(doc(fb.db, 'publicCatches', catchId, 'comments', commentId), {
    text: trimmed.slice(0, 2000),
    editedAt: serverTimestamp(),
  });
}

export async function deleteCatchComment(catchId: string, commentId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'publicCatches', catchId, 'comments', commentId));
}

export function subscribeMyNotifications(myUid: string, onNext: (items: SocialNotification[]) => void): () => void {
  const fb = requireFirebase();
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
          reactionEmoji?: string;
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
          reactionEmoji: data.reactionEmoji,
          read: !!data.read,
          createdAt: data.createdAt,
        };
      })
    );
  });
}

export async function markAllNotificationsRead(myUid: string): Promise<void> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(collection(fb.db, 'users', myUid, 'notifications'), where('read', '==', false), limit(100))
  );
  if (snap.empty) return;
  const batch = writeBatch(fb.db);
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
}

export async function markNotificationRead(myUid: string, notifId: string): Promise<void> {
  const fb = requireFirebase();
  await updateDoc(doc(fb.db, 'users', myUid, 'notifications', notifId), stripUndefinedForFirestore({ read: true }));
}

export async function sendFollowNotification(
  followedUid: string,
  followerUid: string,
  followerDisplayName: string
): Promise<void> {
  if (!followedUid || followedUid === followerUid) return;
  const fb = requireFirebase();
  // Deterministic ID — prevents a second notification when the user unfollows then re-follows
  await setDoc(
    doc(fb.db, 'users', followedUid, 'notifications', `follow_${followerUid}`),
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
  void getUserPushToken(followedUid).then(async (token) => {
    if (!token) return;
    await sendPushNotification({
      to: token,
      title: followerDisplayName,
      body: 'Започна да те следва 🎣',
      data: { type: 'follow', actorUid: followerUid, actorName: followerDisplayName },
    });
  }).catch(() => {});
}

export async function fetchCatchLikers(catchId: string): Promise<CatchLiker[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(query(collection(fb.db, 'publicCatches', catchId, 'likes'), limit(80)));
    return snap.docs.map((d) => {
      const data = d.data() as { displayName?: string; reaction?: ReactionType };
      const name = typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim().slice(0, 120)
        : 'Рибар';
      return { uid: d.id, displayName: name, reaction: data.reaction };
    });
  } catch {
    return [];
  }
}

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
