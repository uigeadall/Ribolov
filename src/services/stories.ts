import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

export type StoryReactionType = 'heart' | 'fire' | 'trophy' | 'fish' | 'wow';

export const STORY_REACTIONS: Record<StoryReactionType, { emoji: string; label: string }> = {
  heart:  { emoji: '❤️', label: 'Харесвам' },
  fire:   { emoji: '🔥', label: 'Огън' },
  trophy: { emoji: '🏆', label: 'Трофей' },
  fish:   { emoji: '🎣', label: 'Улов' },
  wow:    { emoji: '😮', label: 'Уау' },
};

export type StoryReactionSummary = { type: StoryReactionType; emoji: string; count: number };

export type StoryComment = {
  id: string;
  authorUid: string;
  authorName: string;
  text: string;
  createdAt?: unknown;
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

/* ── Story Reactions ─────────────────────────────────────── */

export function subscribeMyStoryReaction(
  storyId: string,
  uid: string,
  cb: (reaction: StoryReactionType | null) => void
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  return onSnapshot(doc(fb.db, 'stories', storyId, 'reactions', uid), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    cb((snap.data()?.reaction as StoryReactionType) ?? 'heart');
  });
}

export async function toggleStoryReaction(
  storyId: string,
  uid: string,
  displayName: string,
  reaction: StoryReactionType
): Promise<StoryReactionType | null> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const ref2 = doc(fb.db, 'stories', storyId, 'reactions', uid);
  const snap = await getDoc(ref2);
  if (snap.exists() && (snap.data()?.reaction ?? 'heart') === reaction) {
    await deleteDoc(ref2);
    return null;
  }
  await setDoc(ref2, { reaction, displayName: (displayName || 'Рибар').slice(0, 120), createdAt: serverTimestamp() });
  return reaction;
}

export async function getStoryReactionSummary(storyId: string): Promise<StoryReactionSummary[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  try {
    const snap = await getDocs(collection(fb.db, 'stories', storyId, 'reactions'));
    const counts = new Map<StoryReactionType, number>();
    snap.docs.forEach((d) => {
      const r: StoryReactionType = (d.data().reaction as StoryReactionType) ?? 'heart';
      counts.set(r, (counts.get(r) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([type, count]) => ({ type, emoji: STORY_REACTIONS[type].emoji, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

/* ── Story Comments ──────────────────────────────────────── */

export function subscribeStoryComments(
  storyId: string,
  onNext: (comments: StoryComment[]) => void
): () => void {
  const fb = ensureFirebase();
  if (!fb) return () => {};
  const q = query(
    collection(fb.db, 'stories', storyId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    onNext(
      snap.docs.map((d) => {
        const data = d.data() as { authorUid: string; authorName: string; text: string; createdAt?: unknown };
        return { id: d.id, authorUid: data.authorUid, authorName: data.authorName, text: data.text, createdAt: data.createdAt };
      })
    );
  });
}

export async function addStoryComment(
  storyId: string,
  authorUid: string,
  authorName: string,
  text: string
): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(fb.db, 'stories', storyId, 'comments'), {
    authorUid,
    authorName: (authorName || 'Рибар').slice(0, 120),
    text: trimmed.slice(0, 500),
    createdAt: serverTimestamp(),
  });
}

export async function deleteStoryComment(storyId: string, commentId: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await deleteDoc(doc(fb.db, 'stories', storyId, 'comments', commentId));
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}ч`;
  if (m > 0) return `${m}м`;
  return 'сега';
}
