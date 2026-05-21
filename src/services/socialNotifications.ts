import {
  addDoc,
  collection,
  doc,
  getDocs,
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
import type { SocialNotification } from './socialTypes';

export async function notifyInteraction(opts: {
  recipientUid: string;
  actorUid: string;
  actorName: string;
  type: 'like' | 'comment';
  /** Catch id when the target is a catch. Either catchId or postId must be set. */
  catchId?: string;
  /** Post id when the target is a free-form feed post. */
  postId?: string;
  preview?: string;
  reactionEmoji?: string;
}): Promise<void> {
  if (opts.recipientUid === opts.actorUid) return;
  if (!opts.recipientUid || !opts.actorUid) return;
  // At least one target must be set — guards against a malformed call writing
  // an orphan notification that has no deep-link target.
  const targetId = opts.postId || opts.catchId;
  if (!targetId) return;
  const fb = requireFirebase();
  const safeName = (opts.actorName || 'Рибар').trim().slice(0, 120) || 'Рибар';
  // Write both slots when we have them. Older clients (and notifications-screen
  // fallback) read `catchId`; the new post-aware path reads `postId` first.
  const payload = {
    actorUid: opts.actorUid,
    actorName: safeName,
    type: opts.type,
    catchId: opts.catchId ?? '',
    ...(opts.postId ? { postId: opts.postId } : {}),
    preview: (opts.preview ?? '').slice(0, 200),
    ...(opts.reactionEmoji ? { reactionEmoji: opts.reactionEmoji } : {}),
    read: false,
    createdAt: serverTimestamp(),
  };
  if (opts.type === 'like') {
    // Deterministic ID — prevents a second notification when the user unlikes then re-likes.
    // Keyed by the target id (post or catch) so a like on each kind doesn't collide.
    await setDoc(
      doc(fb.db, 'users', opts.recipientUid, 'notifications', `like_${opts.actorUid}_${targetId}`),
      payload
    );
  } else {
    // Comments are unique events — each one deserves its own notification
    await addDoc(collection(fb.db, 'users', opts.recipientUid, 'notifications'), payload);
  }
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
          type: 'like' | 'comment' | 'follow' | 'storyLike' | 'storyComment' | 'mention' | 'message';
          catchId?: string;
          postId?: string;
          storyId?: string;
          convId?: string;
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
          postId: data.postId,
          storyId: data.storyId,
          convId: data.convId,
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
  let hasMore = true;
  while (hasMore) {
    const snap = await getDocs(
      query(collection(fb.db, 'users', myUid, 'notifications'), where('read', '==', false), limit(100))
    );
    if (snap.empty) break;
    const batch = writeBatch(fb.db);
    snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
    hasMore = snap.docs.length === 100;
  }
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
}

/**
 * Fan-out: notify every @mentioned user when a post is published. One notification
 * per mentioned UID. Errors are silenced per-recipient so a single rules failure
 * doesn't kill the rest. Self-mentions are skipped.
 */
export async function sendMentionNotifications(
  mentionedUids: string[],
  actorUid: string,
  actorName: string,
  postId: string,
  preview: string,
): Promise<void> {
  if (!actorUid || mentionedUids.length === 0) return;
  const fb = requireFirebase();
  const safeName = (actorName || 'Рибар').trim().slice(0, 120) || 'Рибар';
  await Promise.all(
    [...new Set(mentionedUids)]
      .filter((uid) => uid && uid !== actorUid)
      .map((uid) =>
        setDoc(
          doc(fb.db, 'users', uid, 'notifications', `mention_${actorUid}_${postId}`),
          stripUndefinedForFirestore({
            actorUid,
            actorName: safeName,
            type: 'mention',
            // Reuse the catchId slot for the postId — same as comment notifications.
            catchId: postId,
            preview: preview.slice(0, 200),
            read: false,
            createdAt: serverTimestamp(),
          }),
        ).catch(() => {}),
      ),
  );
}
