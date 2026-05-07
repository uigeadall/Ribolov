import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  limit,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ensureFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

const TTL_MS = 24 * 60 * 60 * 1000;

export type Story = {
  id: string;
  uid: string;
  userName: string;
  userPhotoUrl?: string;
  text: string;
  locationName?: string;
  waterTempC?: number;
  emoji?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  createdAt: string;
  expiresAt: number;
};

/** Качва снимка или видео в Firebase Storage под stories/{uid}/. */
export async function uploadStoryMedia(
  localUri: string,
  uid: string,
  type: 'photo' | 'video'
): Promise<string> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const ext = type === 'video' ? 'mp4' : 'jpg';
  const contentType = type === 'video' ? 'video/mp4' : 'image/jpeg';
  const path = `stories/${uid}/${Date.now()}.${ext}`;
  const storageRef = ref(fb.storage, path);
  const resp = await fetch(localUri);
  const blob = await resp.blob();
  await uploadBytes(storageRef, blob, { contentType });
  return getDownloadURL(storageRef);
}

export async function addStory(s: Omit<Story, 'id' | 'createdAt' | 'expiresAt'>): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  await addDoc(
    collection(fb.db, 'stories'),
    stripUndefinedForFirestore({
      ...s,
      text: s.text.trim().slice(0, 280),
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + TTL_MS,
    })
  );
}

export async function getStories(): Promise<Story[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  try {
    const now = Date.now();
    const snap = await getDocs(
      query(
        collection(fb.db, 'stories'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(50)
      )
    );
    return snap.docs.map((d) => {
      const data = d.data() as Omit<Story, 'id'> & { createdAt?: { toMillis?: () => number } };
      return {
        id: d.id,
        uid: data.uid,
        userName: data.userName,
        userPhotoUrl: data.userPhotoUrl,
        text: data.text,
        locationName: data.locationName,
        waterTempC: data.waterTempC,
        emoji: data.emoji,
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType,
        createdAt:
          typeof data.createdAt?.toMillis === 'function'
            ? new Date(data.createdAt.toMillis()).toISOString()
            : new Date().toISOString(),
        expiresAt: data.expiresAt,
      };
    });
  } catch {
    return [];
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await deleteDoc(doc(fb.db, 'stories', storyId));
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}ч`;
  if (m > 0) return `${m}м`;
  return 'сега';
}
