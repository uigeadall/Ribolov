import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
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
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import type { DirectMessage, ConversationPreview } from '../types';

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
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    limit(50),
  );
  return onSnapshot(q, (snap) => {
    const rows: ConversationPreview[] = snap.docs.map((d) => {
      const data = d.data() as {
        participantIds: string[];
        participantNames?: Record<string, string>;
        lastMessage?: string;
        lastMessageAt?: { toMillis?: () => number } | number;
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
        unreadCount: data.unreadCounts?.[myUid] ?? 0,
      };
    });
    onNext(rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)));
  }, (err) => onError?.(err as Error));
}

export async function listMyConversations(myUid: string, maxCount = 50): Promise<ConversationPreview[]> {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
    limit(maxCount),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => {
    const data = d.data() as {
      participantIds: string[];
      participantNames?: Record<string, string>;
      lastMessage?: string;
      lastMessageAt?: { toMillis?: () => number } | number;
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
      unreadCount: data.unreadCounts?.[myUid] ?? 0,
    };
  });
  return rows.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
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
      onNext(
        snap.docs.reverse().map((d) => {
          const data = d.data() as {
            senderUid: string;
            text: string;
            createdAt?: unknown;
            mediaUrl?: string;
            mediaType?: 'photo' | 'video';
          };
          return {
            id: d.id,
            senderUid: data.senderUid,
            text: data.text,
            createdAt: data.createdAt,
            mediaUrl: data.mediaUrl,
            mediaType: data.mediaType,
          };
        })
      );
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
  return snap.docs.reverse().map((d) => {
    const data = d.data() as {
      senderUid: string;
      text: string;
      createdAt?: unknown;
      mediaUrl?: string;
      mediaType?: 'photo' | 'video';
    };
    return { id: d.id, senderUid: data.senderUid, text: data.text, createdAt: data.createdAt, mediaUrl: data.mediaUrl, mediaType: data.mediaType };
  });
}

export async function sendConversationMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  senderName?: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
): Promise<void> {
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed && !mediaUrl) return;
  const preview = mediaUrl ? (mediaType === 'video' ? '📹 Видео' : '📷 Снимка') : trimmed;
  const batch = writeBatch(fb.db);
  const msgRef = doc(collection(fb.db, 'conversations', convId, 'messages'));
  batch.set(msgRef, stripUndefinedForFirestore({ senderUid, text: trimmed, createdAt: serverTimestamp(), mediaUrl, mediaType }));
  batch.update(doc(fb.db, 'conversations', convId), {
    lastMessage: preview,
    lastMessageAt: serverTimestamp(),
    lastSenderUid: senderUid,
    [`unreadCounts.${recipientUid}`]: increment(1),
  });
  // Increment the per-user aggregate so the badge only needs one doc read
  batch.set(doc(fb.db, 'users', recipientUid), { unreadMessageCount: increment(1) }, { merge: true });
  await batch.commit();
}

export async function markConversationRead(convId: string, myUid: string): Promise<void> {
  const fb = requireFirebase();
  const convRef = doc(fb.db, 'conversations', convId);
  const userRef = doc(fb.db, 'users', myUid);
  await runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(convRef);
    if (!snap.exists()) return;
    const unread: number = (snap.data().unreadCounts?.[myUid] as number) ?? 0;
    tx.update(convRef, { [`unreadCounts.${myUid}`]: 0 });
    if (unread > 0) {
      tx.set(userRef, { unreadMessageCount: increment(-unread) }, { merge: true });
    }
  }).catch(() => {});
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
      const others = snap.docs.filter((d) => d.id !== myUid);
      onChange(others.length > 0 ? others[0]!.id : null);
    },
  );
}
