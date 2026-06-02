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
import { allowMessageSend } from './socialRateLimit';
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

/** Page in older conversations beyond the 50-doc live tail. Uses a
    `lastMessageAt < beforeMs` filter rather than a cursor doc because the
    live subscription's snapshot isn't shared with callers — passing a
    timestamp boundary is the simpler API and avoids stale-doc footguns.
    Returns at most `n` results. */
export async function fetchOlderConversations(
  myUid: string,
  beforeMs: number,
  n = 30,
): Promise<ConversationPreview[]> {
  const fb = requireFirebase();
  if (!myUid || !beforeMs) return [];
  // Composite (participantIds CONTAINS, lastMessageAt DESC) index already
  // exists for the live subscription — same query shape works here.
  // lastMessageAt is written with serverTimestamp(), stored as a Firestore
  // Timestamp — comparing it to a JS number always returns zero results.
  // Convert the millisecond boundary to a Timestamp so the inequality matches.
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    where('lastMessageAt', '<', Timestamp.fromMillis(beforeMs)),
    orderBy('lastMessageAt', 'desc'),
    limit(n),
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (e) {
    addBreadcrumb('messaging', 'fetchOlderConversations_failed', { error: String(e) });
    return [];
  }
  return snap.docs.map((d) => {
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
  if (!allowMessageSend(senderUid)) {
    throw new Error('Твърде много съобщения за кратко време. Опитай по-късно.');
  }
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

  // Build the inbox preview. We layer the sentinel emoji + label, then
  // append the title or caption when present so the row tells the user more
  // than just "media". Caps the total so a long caption can't blow out the
  // row layout in the inbox.
  const buildPreview = (): string => {
    if (sharedRef) {
      const kindLabel = sharedRef.kind === 'catch'
        ? '🎣 Улов'
        : sharedRef.kind === 'post'
          ? '📰 Публикация'
          : '📍 Място';
      const title = sharedRef.title?.trim();
      return title ? `${kindLabel}: ${title}` : kindLabel;
    }
    if (mediaUrl) {
      const kindLabel = mediaType === 'video' ? '📹 Видео' : '📷 Снимка';
      return trimmed ? `${kindLabel}: ${trimmed}` : kindLabel;
    }
    return trimmed;
  };
  const preview = buildPreview().slice(0, 220);
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
  // NOTE: conversations/{convId}.unreadCounts.{recipientUid} (bumped above) is
  // the single source of truth for unread — the bell badge sums these per-conv
  // counts (mute-aware, see subscribeUnreadMessagesCount). There is deliberately
  // no users/{uid}.unreadMessageCount aggregate: it was write-only and drifted,
  // so it was removed (see onNewMessage in functions/src/index.ts).
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

  // Clear the per-conversation unread count. This is the authoritative unread
  // counter — the bell badge sums conversations/{convId}.unreadCounts (see
  // subscribeUnreadMessagesCount), so zeroing my key here is all that's needed.
  //
  // Short-circuit when unreadCount is already 0: ChatDetailScreen calls this
  // on every message snapshot, and most of those snapshots are firing for
  // already-read conversations. Without the early-return, every snapshot
  // ran a no-op transaction that frequently lost the race to the
  // onNewMessage Cloud Function (which writes to the same doc), spamming
  // the log with failed-precondition warnings.
  try {
    await runTransaction(fb.db, async (tx) => {
      const snap = await tx.get(convRef);
      if (!snap.exists()) return;
      const current = (snap.data().unreadCounts?.[myUid] as number) ?? 0;
      if (current === 0) return;
      tx.update(convRef, { [`unreadCounts.${myUid}`]: 0 });
    });
  } catch {
    // Conv-doc clear failed (likely permission or contention). Caller will
    // retry on the next snapshot since markConversationRead is called
    // per-snapshot from the message subscription.
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
  // Guard against signed-out callers — without a uid the inner subscribes
  // would build invalid Firestore paths like `users//mutedConversations`,
  // which logs a console error and leaks a half-attached listener.
  if (!myUid) {
    onNext(0);
    return () => {};
  }
  // Mute-aware: sums unread across conversations the user hasn't muted. This
  // per-conversation sum is the only unread counter — there is no
  // users/{uid}.unreadMessageCount aggregate (it was mute-unaware and drifted,
  // so it was removed). Cost is one extra listener per session (the same conv
  // list the Inbox already subscribes to); Firestore deduplicates the reads.
  let convs: ConversationPreview[] = [];
  let muted: Set<string> = new Set();
  const emit = () => {
    let count = 0;
    for (const c of convs) {
      if (!muted.has(c.convId)) count += c.unreadCount;
    }
    onNext(Math.max(0, count));
  };
  const unsubConvs = subscribeMyConversations(myUid, (next) => {
    convs = next;
    emit();
  });
  const unsubMuted = subscribeMutedConversations(myUid, (next) => {
    muted = next;
    emit();
  });
  return () => {
    unsubConvs();
    unsubMuted();
  };
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
  // Mirror the mute state into the conversation's denormalized
  // `participantData` cache so the `onNewMessage` Cloud Function picks
  // it up on the next message without a separate mutedConversations read.
  // Best-effort: if the mirror write fails, the next onNewMessage call
  // falls through its lazy-backfill path and rebuilds the cache anyway.
  await setDoc(
    doc(fb.db, 'conversations', convId),
    stripUndefinedForFirestore({ participantData: { [myUid]: { muted: true } } }),
    { merge: true },
  ).catch(() => {});
  // Drop any orphan message notification doc for this conv. Without this,
  // muting a conv that has an unread message_{convId} notification leaves
  // the bell badge inflated until the user opens the chat or the 30-day
  // cleanup function deletes it (which only runs on `read:true` docs).
  // The contract of "mute" is that the conv goes quiet — letting the
  // badge linger violates that. Best-effort: failure to delete a stale
  // row isn't worse than the current behavior.
  await deleteDoc(doc(fb.db, 'users', myUid, 'notifications', `message_${convId}`)).catch(() => {});
}

export async function unmuteConversation(myUid: string, convId: string): Promise<void> {
  if (!myUid || !convId) return;
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'users', myUid, 'mutedConversations', convId));
  // Sync the participantData mirror — same reasoning as muteConversation.
  await setDoc(
    doc(fb.db, 'conversations', convId),
    stripUndefinedForFirestore({ participantData: { [myUid]: { muted: false } } }),
    { merge: true },
  ).catch(() => {});
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
  // Flip the per-conversation counter from 0 → 1. If the conv was already
  // unread this is a no-op — the per-conv unreadCounts map is the only counter
  // the bell badge reads, so there's nothing else to keep in sync. (Repeated
  // mark-unread swipes on an already-unread row are therefore harmless.)
  await runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(convRef);
    if (!snap.exists()) return;
    const current = (snap.data().unreadCounts?.[myUid] as number) ?? 0;
    if (current > 0) return;
    tx.update(convRef, { [`unreadCounts.${myUid}`]: 1 });
  }).catch(() => undefined);
}
