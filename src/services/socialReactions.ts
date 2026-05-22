import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowLikeToggle } from './socialRateLimit';
import { notifyInteraction } from './socialNotifications';
import { captureException } from './observability';
import type { ReactionType, ReactionSummaryItem, CatchLiker } from './socialTypes';
import { REACTIONS } from './socialTypes';

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
  const catchRef = doc(fb.db, 'publicCatches', catchId);

  const { removed, isNew } = await runTransaction(fb.db, async (txn) => {
    const snap = await txn.get(refLike);
    const existing = snap.exists() ? (snap.data()?.reaction ?? 'heart') : null;

    if (existing === reaction) {
      txn.delete(refLike);
      txn.update(catchRef, { likeCount: increment(-1) });
      return { removed: true, isNew: false };
    }
    txn.set(
      refLike,
      stripUndefinedForFirestore({
        createdAt: serverTimestamp(),
        displayName: actorName.slice(0, 120),
        reaction,
      }),
    );
    if (existing === null) {
      txn.update(catchRef, { likeCount: increment(1) });
    }
    return { removed: false, isNew: existing === null };
  });

  if (removed) return null;

  if (isNew) {
    // Only notify on first reaction, not on reaction change — fire-and-forget.
    // We don't await (reaction already succeeded; failing the whole call now
    // would lie to the user) but we DO capture failures to observability so
    // silent drops are visible to us, not just users wondering why no bell lit.
    notifyInteraction({
      recipientUid: catchOwnerUid,
      actorUid: myUid,
      actorName: (actorName || 'Рибар').slice(0, 120),
      type: 'like',
      catchId,
      reactionEmoji: REACTIONS[reaction].emoji,
    }).catch((e: unknown) => {
      captureException(e, { area: 'notify_catch_like', catchId, recipientUid: catchOwnerUid });
    });
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

// ─── Post reactions ───────────────────────────────────────────────────────────
// Mirror of the catch reaction system for free-form posts (`posts/{postId}`).
// Same data shape, same enum, same rate limit. Notifications use the `postId`
// slot on the notification doc so NotificationsScreen can deep-link into the
// feed instead of the (non-existent) catch detail. Catches and posts live in
// separate collections, so a single `togglePostReaction` cannot accidentally
// touch a catch and vice versa.

/** Subscribe to the current user's reaction on a post (null = no reaction). */
export function subscribeMyReactionOnPost(
  postId: string,
  myUid: string,
  cb: (reaction: ReactionType | null) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, 'posts', postId, 'likes', myUid), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    const r = snap.data()?.reaction as ReactionType | undefined;
    cb(r ?? 'heart');
  });
}

/** Returns top reactions on a post with counts, sorted desc. */
export async function fetchPostReactionSummary(postId: string): Promise<ReactionSummaryItem[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(query(collection(fb.db, 'posts', postId, 'likes'), limit(50)));
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

/** Toggle or change a reaction on a post. Returns active reaction or null. */
export async function togglePostReaction(
  postId: string,
  myUid: string,
  postOwnerUid: string,
  actorName: string,
  reaction: ReactionType,
): Promise<ReactionType | null> {
  if (!allowLikeToggle(myUid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = requireFirebase();
  const refLike = doc(fb.db, 'posts', postId, 'likes', myUid);
  const postRef = doc(fb.db, 'posts', postId);

  const { removed, isNew } = await runTransaction(fb.db, async (txn) => {
    const snap = await txn.get(refLike);
    const existing = snap.exists() ? (snap.data()?.reaction ?? 'heart') : null;

    if (existing === reaction) {
      txn.delete(refLike);
      txn.update(postRef, { likeCount: increment(-1) });
      return { removed: true, isNew: false };
    }
    txn.set(
      refLike,
      stripUndefinedForFirestore({
        createdAt: serverTimestamp(),
        displayName: actorName.slice(0, 120),
        reaction,
      }),
    );
    if (existing === null) {
      txn.update(postRef, { likeCount: increment(1) });
    }
    return { removed: false, isNew: existing === null };
  });

  if (removed) return null;

  if (isNew) {
    notifyInteraction({
      recipientUid: postOwnerUid,
      actorUid: myUid,
      actorName: (actorName || 'Рибар').slice(0, 120),
      type: 'like',
      postId,
      reactionEmoji: REACTIONS[reaction].emoji,
    }).catch((e: unknown) => {
      captureException(e, { area: 'notify_post_like', postId, recipientUid: postOwnerUid });
    });
  }
  return reaction;
}

export async function fetchPostLikers(postId: string): Promise<CatchLiker[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(query(collection(fb.db, 'posts', postId, 'likes'), limit(80)));
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
