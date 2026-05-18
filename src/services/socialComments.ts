import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowComment } from './socialRateLimit';
import { notifyInteraction } from './socialNotifications';
import type { FeedComment } from './socialTypes';

export async function fetchCatchCommentCount(catchId: string): Promise<number> {
  const fb = requireFirebase();
  try {
    const agg = await getCountFromServer(collection(fb.db, 'publicCatches', catchId, 'comments'));
    return agg.data().count;
  } catch {
    return 0;
  }
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
