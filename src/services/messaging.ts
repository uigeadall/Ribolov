import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  increment,
  onSnapshot,
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
  return rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function subscribeConversationMessages(
  convId: string,
  onNext: (msgs: DirectMessage[]) => void,
  onError?: (e: Error) => void
): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(300)
  );
  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((d) => {
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

export async function sendConversationMessage(
  convId: string,
  senderUid: string,
  text: string,
  recipientUid: string,
  mediaUrl?: string,
  mediaType?: 'photo' | 'video',
): Promise<void> {
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed && !mediaUrl) return;
  await addDoc(
    collection(fb.db, 'conversations', convId, 'messages'),
    stripUndefinedForFirestore({ senderUid, text: trimmed, createdAt: serverTimestamp(), mediaUrl, mediaType }),
  );
  await updateDoc(doc(fb.db, 'conversations', convId), {
    lastMessage: mediaUrl ? (mediaType === 'video' ? '📹 Видео' : '📷 Снимка') : trimmed,
    lastMessageAt: serverTimestamp(),
    lastSenderUid: senderUid,
    [`unreadCounts.${recipientUid}`]: increment(1),
  });
}

export async function markConversationRead(convId: string, myUid: string): Promise<void> {
  const fb = requireFirebase();
  await updateDoc(doc(fb.db, 'conversations', convId), {
    [`unreadCounts.${myUid}`]: 0,
  }).catch(() => {});
}

export function subscribeUnreadMessagesCount(
  myUid: string,
  onNext: (count: number) => void,
): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'conversations'),
    where('participantIds', 'array-contains', myUid),
  );
  return onSnapshot(q, (snap) => {
    let total = 0;
    snap.docs.forEach((d) => {
      const counts = (d.data() as Record<string, unknown>).unreadCounts as Record<string, number> | undefined;
      total += counts?.[myUid] ?? 0;
    });
    onNext(total);
  }, () => onNext(0));
}
