import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { ensureFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

export type DamFeedPostDoc = {
  id: string;
  ownerUid: string;
  ownerName?: string;
  damId: string;
  photoUrl: string;
  storagePath: string;
  caption?: string;
  createdAt?: unknown;
};

/** Изтриване на всички dam feed постове на потребителя (при изтриване на акаунт). Изисква collection group индекс за `feedPosts` + `ownerUid`. */
export async function deleteAllUserDamFeedPosts(ownerUid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb || !ownerUid.trim()) return;
  try {
    const q = query(collectionGroup(fb.db, 'feedPosts'), where('ownerUid', '==', ownerUid), limit(500));
    for (;;) {
      const snap = await getDocs(q);
      if (snap.empty) break;
      const storagePaths: string[] = [];
      let batch = writeBatch(fb.db);
      let ops = 0;
      for (const d of snap.docs) {
        const data = d.data() as { storagePath?: unknown };
        const sp = typeof data.storagePath === 'string' ? data.storagePath.trim() : '';
        if (sp) storagePaths.push(sp);
        batch.delete(d.ref);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(fb.db);
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      for (const p of storagePaths) {
        try {
          await deleteObject(ref(fb.storage, p));
        } catch {
          /* файлът може да липсва */
        }
      }
      if (snap.docs.length < 500) break;
    }
  } catch {
    /* без индекс / мрежа — не блокираме изтриването на акаунта */
  }
}

export function subscribeDamFeedPosts(
  damId: string,
  onNext: (posts: DamFeedPostDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'damFeeds', damId, 'feedPosts'),
    orderBy('createdAt', 'desc'),
    limit(40)
  );
  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((d) => {
          const data = d.data() as Omit<DamFeedPostDoc, 'id'>;
          return { id: d.id, ...data };
        })
      );
    },
    (err) => onError?.(err as Error)
  );
}

export async function createDamFeedPost(opts: {
  damId: string;
  ownerUid: string;
  ownerName: string;
  localImageUri: string;
  caption?: string;
}): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const postId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `damFeeds/${opts.damId}/${opts.ownerUid}/${postId}.jpg`;
  const storageRef = ref(fb.storage, path);
  const resp = await fetch(opts.localImageUri);
  const blob = await resp.blob();
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  const photoUrl = await getDownloadURL(storageRef);
  await addDoc(
    collection(fb.db, 'damFeeds', opts.damId, 'feedPosts'),
    stripUndefinedForFirestore({
      ownerUid: opts.ownerUid,
      ownerName: opts.ownerName,
      damId: opts.damId,
      photoUrl,
      storagePath: path,
      caption: opts.caption?.trim() ?? '',
      createdAt: serverTimestamp(),
    })
  );
}

export async function deleteDamFeedPost(damId: string, postId: string, storagePath: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  await deleteDoc(doc(fb.db, 'damFeeds', damId, 'feedPosts', postId));
  try {
    await deleteObject(ref(fb.storage, storagePath));
  } catch {
    /* файлът може да липсва */
  }
}
