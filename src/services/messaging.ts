import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  serverTimestamp,
  increment,
  onSnapshot,
  writeBatch,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { addBreadcrumb } from './observability';
import type { DirectMessage, ConversationPreview, MessageReplyRef, SharedRef } from '../types';

/** Window during which the sender can still edit or delete their own message. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Typing entries older than this are treated as stale and ignored. */
const TYPING_STALE_MS = 8_000;

/** Generate a stable client-side message id so retries don't create duplicates. */
export function makeMessageClientId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}_${rnd}`;
}

export async function ensureDirectConversation(
  myUid: string,
  myName: string,
  otherUid: string,
  otherName: string
): Promise<string> {
  const fb = requireFirebase();
  const participantIds = [myUid, otherUid].sort();
  const convId = participantIds.join('_');
  const convRef = doc(fb.db, 'conversations', convId);
  // Read first to avoid overwriting lastMessageAt on re-open.
  const existing = await getDoc(convRef).catch(() => null);
  const isNew = !existing?.exists();
  await setDoc(
    convRef,
    stripUndefinedForFirestore({
      participantIds,
      participantNames: { [myUid]: myName, [otherUid]: otherName },
      ...(isNew ? { lastMessageAt: serverTimestamp() } : {}),
    }),
    { merge: true }
  );
  return convId;
}

export function subscribeMyConversations(
  myUid: string,
  onNext: (convs: ConversationPreview[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const fb = requireFirebase();
  // orderBy('lastMessageAt', 'desc') is critical for users with >50 conversations
  // — without it Firestore returns an arbitrary 50, not the most recent ones.
  // The local sort below is kept as a tiebreaker so display order is stable.
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    orderBy('lastMessageAt', 'desc'),
    limit(50),
  );
  return onSnapshot(q, (snap) => {
    const rows: ConversationPreview[] = snap.docs.map((d) => {
      const data = d.data() as {
        participantIds: string[];
        participantNames?: Record<string, string>;
        lastMessage?: string;
        lastMessageAt?: { toMillis?: () => number } | number;
        lastSenderUid?: string;
        unreadCounts?: Record<string, number>;
      };
      const other = data.participantIds.find((id) => id !== myUid) ?? '';
      const ts = data.lastMessageAt;
      const lastMessageAt = ts ? (typeof ts === 'number' ? ts : ts.toMillis?.() ?? 0) : 0;
      return {
        convId: d.id,
        otherUid: other,
        otherName: data.participantNames?.[other] ?? 'Рибар',
        lastMessage: data.lastMessage,
        lastMessageAt,
        lastSenderUid: data.lastSenderUid,
        unreadCount: data.unreadCounts?.[myUid] ?? 0,
      };
    });
    onNext(rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)));
  }, (err) => onError?.(err as Error));
}

export async function listMyConversations(myUid: string, maxCount = 50): Promise<ConversationPreview[]> {
  const fb = requireFirebase();
  // orderBy ensures the `limit` actually returns the most-recent conversations,
  // not an arbitrary slice (see subscribeMyConversations above for the same fix).
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    orderBy('lastMessageAt', 'desc'),
    limit(maxCount),
  );
  // Permission errors here are usually transient (stale auth token after sign-in,
  // App Check race, or rules drift on the deployed project). Return [] so callers
  // — like the share picker — degrade to an empty state instead of crashing the UI.
  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    addBreadcrumb('messaging', 'listMyConversations_failed', { error: String(e) });
    return [];
  }
  const rows = snap.docs.map((d) => {
    const data = d.data() as {
      participantIds: string[];
      participantNames?: Record<string, string>;
      lastMessage?: string;
      lastMessageAt?: { toMillis?: () => number } | number;
      lastSenderUid?: string;
      unreadCounts?: Record<string, number>;
    };
    const other = data.participantIds.find((id) => id !== myUid) ?? '';
    const ts = data.lastMessageAt;
    const lastMessageAt = ts
      ? typeof ts === 'number' ? ts : ts.toMillis?.() ?? 0
      : 0;
    return {
      convId: d.id,
      otherUid: other,
      otherName: data.participantNames?.[other] ?? 'Рибар',
      lastMessage: data.lastMessage,
      lastMessageAt,
      lastSenderUid: data.lastSenderUid,
      unreadCount: data.unreadCounts?.[myUid] ?? 0,
    };
  });
  return rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
}

type RawMessageDoc = {
  senderUid: string;
  text: string;
  createdAt?: unknown;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  readAt?: unknown;
  editedAt?: unknown;
  deletedAt?: unknown;
  replyTo?: MessageReplyRef;
  sharedRef?: SharedRef;
};

function mapMessage(id: string, data: RawMessageDoc): DirectMessage {
  return {
    id,
    senderUid: data.senderUid,
    text: data.text,
    createdAt: data.createdAt,
    mediaUrl: data.mediaUrl,
    mediaType: data.mediaType,
    readAt: data.readAt,
    editedAt: data.editedAt,
    deletedAt: data.deletedAt,
    replyTo: data.replyTo,
    sharedRef: data.sharedRef,
  };
}

export function subscribeConversationMessages(
  convId: string,
  onNext: (msgs: DirectMessage[]) => void,
  onError?: (e: Error) => void
): () => void {
  const fb = requireFirebase();
  // desc + limit keeps the newest 100; reverse for chronological display
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      onNext(snap.docs.reverse().map((d) => mapMessage(d.id, d.data() as RawMessageDoc)));
    },
    (err) => onError?.(err as Error)
  );
}

export async function loadOlderMessages(
  convId: string,
  beforeCreatedAt: unknown,
  count = 40
): Promise<DirectMessage[]> {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'desc'),
    startAfter(beforeCreatedAt),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.reverse().map((d) => mapMessage(d.id, d.data() as RawMessageDoc));
}

export async function sendConversationMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  senderName?: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
  clientId?: string,
  replyTo?: MessageReplyRef,
  sharedRef?: SharedRef,
): Promise<void> {
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed && !mediaUrl && !sharedRef) return;

  // Idempotency: if a clientId is supplied and a doc already exists, this call is a retry of
  // an already-committed send. Bail out before re-incrementing unread counts.
  const msgRef = clientId
    ? doc(fb.db, 'conversations', convId, 'messages', clientId)
    : doc(collection(fb.db, 'conversations', convId, 'messages'));
  if (clientId) {
    const existing = await getDoc(msgRef).catch(() => null);
    if (existing?.exists()) return;
  }

  const preview = sharedRef
    ? sharedRef.kind === 'catch' ? '🎣 Сподели улов'
      : sharedRef.kind === 'post' ? '📰 Сподели публикация'
      : '📍 Сподели място'
    : mediaUrl ? (mediaType === 'video' ? '📹 Видео' : '📷 Снимка')
    : trimmed;
  const batch = writeBatch(fb.db);
  batch.set(msgRef, stripUndefinedForFirestore({
    senderUid,
    text: trimmed,
    createdAt: serverTimestamp(),
    mediaUrl,
    mediaType,
    replyTo,
    sharedRef,
  }));
  batch.update(doc(fb.db, 'conversations', convId), {
    lastMessage: preview,
    lastMessageAt: serverTimestamp(),
    lastSenderUid: senderUid,
    [`unreadCounts.${recipientUid}`]: increment(1),
  });
  // NOTE: The recipient's users/{uid}.unreadMessageCount aggregate is bumped by
  // the onNewMessage Cloud Function (admin SDK), not by the client — the
  // user-doc rule requires isSelf(userId) which would reject this cross-user
  // write from the sender. The conversation's unreadCounts.{recipientUid} is
  // the authoritative per-conversation counter; the aggregate is just a UX
  // optimization for the global bell badge.
  await batch.commit();
}

/** One-shot read of the current user's unread count for a conversation. Used
    by ChatDetailScreen to snapshot the count BEFORE calling
    markConversationRead, so we can render an "N нови" divider above the
    first unseen message. Returns 0 if the conv doesn't exist or the read
    fails. */
export async function fetchMyUnreadInConversation(convId: string, myUid: string): Promise<number> {
  if (!convId || !myUid) return 0;
  const fb = requireFirebase();
  try {
    const snap = await getDoc(doc(fb.db, 'conversations', convId));
    if (!snap.exists()) return 0;
    const data = snap.data() as { unreadCounts?: Record<string, number> };
    return data.unreadCounts?.[myUid] ?? 0;
  } catch {
    return 0;
  }
}

export async function markConversationRead(convId: string, myUid: string): Promise<void> {
  const fb = requireFirebase();
  const convRef = doc(fb.db, 'conversations', convId);
  const userRef = doc(fb.db, 'users', myUid);

  // Clear the per-conversation unread count FIRST, on its own transaction. The
  // earlier implementation bundled this with the user-aggregate decrement, but
  // the user-doc rule requires `request.resource.data.uid == userId` — and a
  // merge write that didn't include `uid` (because the user doc was first
  // created by the Cloud Function without setting it) would be rejected,
  // aborting the whole transaction and leaving the per-conversation badge
  // stuck. Splitting them means a failed aggregate decrement no longer rolls
  // back the conv-doc clear.
  let unread = 0;
  try {
    await runTransaction(fb.db, async (tx) => {
      const snap = await tx.get(convRef);
      if (!snap.exists()) return;
      unread = (snap.data().unreadCounts?.[myUid] as number) ?? 0;
      tx.update(convRef, { [`unreadCounts.${myUid}`]: 0 });
    });
  } catch {
    // Conv-doc clear failed (likely permission). Caller will retry on next
    // snapshot since markConversationRead is called per-snapshot from the
    // message subscription.
  }

  // Decrement the user aggregate as a separate best-effort write. Includes
  // `uid: myUid` so the user-doc rule passes even if the doc was previously
  // created by the Cloud Function without that field.
  if (unread > 0) {
    await setDoc(
      userRef,
      { uid: myUid, unreadMessageCount: increment(-unread) },
      { merge: true },
    ).catch(() => {});
  }

  // Also mark the bell-icon notification entry for this conversation as read.
  // The Cloud Function writes it with the deterministic id message_{convId}.
  // Best-effort — the doc may not exist if push didn't fire for this conv yet.
  await updateDoc(
    doc(fb.db, 'users', myUid, 'notifications', `message_${convId}`),
    { read: true },
  ).catch(() => {});
}

/** Stamp readAt on incoming messages the caller already has from a subscription snapshot.
    Avoids the extra getDocs round-trip that a "mark all unread" helper would need. */
export async function markMessagesReadFromList(
  convId: string,
  myUid: string,
  messages: DirectMessage[],
): Promise<void> {
  const targets = messages.filter((m) => m.senderUid !== myUid && !m.readAt);
  if (targets.length === 0) return;
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  let updates = 0;
  for (const m of targets) {
    batch.update(doc(fb.db, 'conversations', convId, 'messages', m.id), { readAt: serverTimestamp() });
    updates += 1;
    if (updates >= 400) break; // Firestore batch limit is 500; leave room.
  }
  await batch.commit().catch(() => {});
}

export function subscribeUnreadMessagesCount(
  myUid: string,
  onNext: (count: number) => void,
): () => void {
  // Single-doc listener on the user aggregate — O(1) instead of scanning all conversations
  const fb = requireFirebase();
  return onSnapshot(
    doc(fb.db, 'users', myUid),
    (snap) => onNext(Math.max(0, (snap.data()?.unreadMessageCount as number) ?? 0)),
    () => onNext(0),
  );
}

export async function setTypingStatus(convId: string, uid: string, isTyping: boolean): Promise<void> {
  const fb = requireFirebase();
  const ref = doc(fb.db, 'conversations', convId, 'typing', uid);
  if (isTyping) {
    await setDoc(ref, { uid, at: serverTimestamp() });
  } else {
    await deleteDoc(ref);
  }
}

export function subscribeTyping(
  convId: string,
  myUid: string,
  onChange: (typingUid: string | null) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(
    collection(fb.db, 'conversations', convId, 'typing'),
    (snap) => {
      const now = Date.now();
      const others = snap.docs.filter((d) => {
        if (d.id === myUid) return false;
        const at = (d.data() as { at?: Timestamp }).at;
        // Guard against ghost typing docs that were never cleared (app crash, race).
        if (!at?.toMillis) return false;
        return now - at.toMillis() < TYPING_STALE_MS;
      });
      onChange(others.length > 0 ? others[0]!.id : null);
    },
  );
}

export async function editMessage(
  convId: string,
  messageId: string,
  myUid: string,
  newText: string,
): Promise<void> {
  const fb = requireFirebase();
  const trimmed = newText.trim();
  if (!trimmed) throw new Error('Message text cannot be empty.');
  const ref = doc(fb.db, 'conversations', convId, 'messages', messageId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Message not found.');
  const data = snap.data() as RawMessageDoc;
  if (data.senderUid !== myUid) throw new Error('Only the sender can edit a message.');
  const createdMs = (data.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - createdMs > MESSAGE_EDIT_WINDOW_MS) {
    throw new Error('Edit window expired.');
  }
  await updateDoc(ref, { text: trimmed, editedAt: serverTimestamp() });
}

export async function deleteMessage(
  convId: string,
  messageId: string,
  myUid: string,
): Promise<void> {
  const fb = requireFirebase();
  const ref = doc(fb.db, 'conversations', convId, 'messages', messageId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as RawMessageDoc;
  if (data.senderUid !== myUid) throw new Error('Only the sender can delete a message.');
  const createdMs = (data.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - createdMs > MESSAGE_EDIT_WINDOW_MS) {
    throw new Error('Delete window expired.');
  }
  await updateDoc(ref, { deletedAt: serverTimestamp() });
}

export async function setMessageReaction(
  convId: string,
  messageId: string,
  uid: string,
  emoji: 'heart' | 'fire' | 'trophy' | 'fish' | 'wow' | null,
): Promise<void> {
  const fb = requireFirebase();
  const ref = doc(fb.db, 'conversations', convId, 'reactions', messageId);
  if (emoji === null) {
    await setDoc(ref, { [uid]: deleteField() }, { merge: true });
  } else {
    await setDoc(ref, { [uid]: emoji }, { merge: true });
  }
}

export function subscribeConversationReactions(
  convId: string,
  onChange: (byMessageId: Record<string, Record<string, string>>) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(
    collection(fb.db, 'conversations', convId, 'reactions'),
    (snap) => {
      const out: Record<string, Record<string, string>> = {};
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const reactions: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') reactions[k] = v;
        }
        out[d.id] = reactions;
      }
      onChange(out);
    },
    () => onChange({}),
  );
}

/** Per-user conversation mute. Stored under users/{uid}/mutedConversations/{convId}
    so the rule surface stays "you can write your own private prefs" and the
    other participant never sees your mute state. Mute is local-effect only:
    we still receive the messages, we just suppress push (via the Cloud
    Function checking this set) and hide the unread badge in the inbox. */
export async function muteConversation(myUid: string, convId: string): Promise<void> {
  if (!myUid || !convId) return;
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'users', myUid, 'mutedConversations', convId),
    stripUndefinedForFirestore({ convId, mutedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function unmuteConversation(myUid: string, convId: string): Promise<void> {
  if (!myUid || !convId) return;
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'users', myUid, 'mutedConversations', convId));
}

/** Subscribe to the set of conversation IDs I've muted. Tiny collection (one
    doc per muted conv), cheap to watch. */
export function subscribeMutedConversations(
  myUid: string,
  cb: (mutedIds: Set<string>) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(
    collection(fb.db, 'users', myUid, 'mutedConversations'),
    (snap) => cb(new Set(snap.docs.map((d) => d.id))),
    () => cb(new Set()),
  );
}

/** Mark a conversation as unread by setting its unreadCounts.{myUid} to at
    least 1. Used by the swipe action so a long thread you've already read
    pops back to the top of the inbox with a badge. We don't track which
    specific message — just "needs attention". The next open clears it via
    markConversationRead. */
export async function markConversationUnread(convId: string, myUid: string): Promise<void> {
  if (!convId || !myUid) return;
  const fb = requireFirebase();
  const convRef = doc(fb.db, 'conversations', convId);
  // Only bump the user aggregate when we actually transition from 0 → 1.
  // If the conv was already unread the transaction is a no-op, and we MUST
  // skip the aggregate increment too — otherwise repeated mark-unread swipes
  // on the same row leak phantom counts into the bell badge.
  let didFlip = false;
  await runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(convRef);
    if (!snap.exists()) return;
    const current = (snap.data().unreadCounts?.[myUid] as number) ?? 0;
    if (current > 0) return;
    tx.update(convRef, { [`unreadCounts.${myUid}`]: 1 });
    didFlip = true;
  }).catch(() => undefined);
  if (didFlip) {
    await setDoc(
      doc(fb.db, 'users', myUid),
      { uid: myUid, unreadMessageCount: increment(1) },
      { merge: true },
    ).catch(() => undefined);
  }
}
