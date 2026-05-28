import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  increment,
  limit,
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

// ─── My-reaction in-memory cache ─────────────────────────────────────────────
// The old per-card `onSnapshot` listener cost one persistent listener per
// visible card — 20 cards in a feed = 20 open listeners that re-fired on every
// reaction change anywhere on those catches (even other users' reactions, via
// downstream metadata churn). We replace it with a one-shot getDoc plus an
// in-memory cache:
//
//   - First read for a (catchId, myUid) pair fires a single getDoc.
//   - Subsequent reads within MY_REACTION_TTL_MS return the cached value
//     without a network call — covers the common case of re-mounting a card
//     during a scroll-through-and-back.
//   - `toggleCatchReaction` / `togglePostReaction` write through to the cache
//     so the optimistic update is the source of truth — no second roundtrip.
//
// Multi-device sync (same user logged in on phone + tablet) is the one thing
// this loses; the user's reaction made on device A won't auto-appear on
// device B until they re-enter the feed (cache miss, fresh fetch). That's
// an acceptable trade for shedding 20+ active listeners per feed view.

type ReactionCacheEntry = { reaction: ReactionType | null; at: number };
const _myReactionCacheCatch = new Map<string, ReactionCacheEntry>();
const _myReactionCachePost = new Map<string, ReactionCacheEntry>();
const MY_REACTION_TTL_MS = 5 * 60 * 1000;

function reactionCacheKey(targetId: string, myUid: string): string {
  return `${targetId}:${myUid}`;
}

/** Test-only / future-feature seam: lets a "refresh on focus" handler nuke
    the cache and force a re-fetch. Not exported until something needs it. */
function invalidateMyReactionCache(): void {
  _myReactionCacheCatch.clear();
  _myReactionCachePost.clear();
}
// Referenced from the module to keep the symbol from being tree-shaken away
// in case a future caller wants it. The `void` cast keeps the lint silent
// for "unused" without actually doing anything at runtime.
void invalidateMyReactionCache;

/** Subscribe-shape API kept for source compatibility, but backed by a one-shot
    fetch + memory cache. Returns a no-op unsubscribe (nothing to detach). */
export function subscribeMyReactionOnCatch(
  catchId: string,
  myUid: string,
  cb: (reaction: ReactionType | null) => void
): () => void {
  const key = reactionCacheKey(catchId, myUid);
  const cached = _myReactionCacheCatch.get(key);
  if (cached && Date.now() - cached.at < MY_REACTION_TTL_MS) {
    cb(cached.reaction);
    return () => {};
  }
  let cancelled = false;
  void (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'publicCatches', catchId, 'likes', myUid));
      const r: ReactionType | null = snap.exists()
        ? ((snap.data()?.reaction as ReactionType | undefined) ?? 'heart')
        : null;
      _myReactionCacheCatch.set(key, { reaction: r, at: Date.now() });
      if (!cancelled) cb(r);
    } catch {
      if (!cancelled) cb(null);
    }
  })();
  return () => { cancelled = true; };
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

  // Keep the my-reaction cache consistent so the next `subscribeMyReactionOnCatch`
  // call sees the just-written state without a second roundtrip.
  _myReactionCacheCatch.set(reactionCacheKey(catchId, myUid), {
    reaction: removed ? null : reaction,
    at: Date.now(),
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

/** One-shot fetch + memory cache for post reactions. Mirrors the catch
    version above — same cache TTL, same trade-off on multi-device sync. */
export function subscribeMyReactionOnPost(
  postId: string,
  myUid: string,
  cb: (reaction: ReactionType | null) => void,
): () => void {
  const key = reactionCacheKey(postId, myUid);
  const cached = _myReactionCachePost.get(key);
  if (cached && Date.now() - cached.at < MY_REACTION_TTL_MS) {
    cb(cached.reaction);
    return () => {};
  }
  let cancelled = false;
  void (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'posts', postId, 'likes', myUid));
      const r: ReactionType | null = snap.exists()
        ? ((snap.data()?.reaction as ReactionType | undefined) ?? 'heart')
        : null;
      _myReactionCachePost.set(key, { reaction: r, at: Date.now() });
      if (!cancelled) cb(r);
    } catch {
      if (!cancelled) cb(null);
    }
  })();
  return () => { cancelled = true; };
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

  // Mirror update to the my-reaction cache so the next subscribe sees the
  // just-written state without a roundtrip.
  _myReactionCachePost.set(reactionCacheKey(postId, myUid), {
    reaction: removed ? null : reaction,
    at: Date.now(),
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
