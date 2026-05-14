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
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { getUserPushToken, sendPushNotification } from './pushNotifications';

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
  const fb = requireFirebase();
  const token = await fb.auth.currentUser?.getIdToken(true);
  if (!token) throw new Error('Не е влязло в акаунт.');
  const bucket = fb.auth.app.options.storageBucket;
  if (!bucket) throw new Error('Firebase Storage не е конфигуриран.');

  const ext = type === 'video' ? 'mp4' : 'jpg';
  const contentType = type === 'video' ? 'video/mp4' : 'image/jpeg';
  const storagePath = `stories/${uid}/${Date.now()}.${ext}`;

  const result = await uploadAsync(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
    localUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType, 'Authorization': `Bearer ${token}` },
    }
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Качването неуспешно (${result.status})`);
  }

  const meta = JSON.parse(result.body) as { name: string; downloadTokens: string };
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(meta.name)}?alt=media&token=${meta.downloadTokens}`;
}

export async function addStory(s: Omit<Story, 'id' | 'createdAt' | 'expiresAt'>): Promise<void> {
  const fb = requireFirebase();
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
  const fb = requireFirebase();
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
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'stories', storyId));
}

/* ── Story Reactions ─────────────────────────────────────── */

export function subscribeMyStoryReaction(
  storyId: string,
  uid: string,
  cb: (reaction: StoryReactionType | null) => void
): () => void {
  const fb = requireFirebase();
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
  const fb = requireFirebase();
  const ref2 = doc(fb.db, 'stories', storyId, 'reactions', uid);
  const snap = await getDoc(ref2);
  if (snap.exists() && (snap.data()?.reaction ?? 'heart') === reaction) {
    await deleteDoc(ref2);
    return null;
  }
  await setDoc(ref2, { reaction, displayName: (displayName || 'Рибар').slice(0, 120), createdAt: serverTimestamp() });

  void (async () => {
    const storySnap = await getDoc(doc(fb.db, 'stories', storyId));
    if (!storySnap.exists()) return;
    const ownerUid = storySnap.data()?.uid as string | undefined;
    if (!ownerUid || ownerUid === uid) return;
    const emoji = STORY_REACTIONS[reaction].emoji;
    await setDoc(
      doc(fb.db, 'users', ownerUid, 'notifications', `storyLike_${uid}_${storyId}`),
      { actorUid: uid, actorName: (displayName || 'Рибар').slice(0, 120), type: 'storyLike', storyId, reactionEmoji: emoji, preview: '', read: false, createdAt: serverTimestamp() }
    );
    const token = await getUserPushToken(ownerUid);
    if (!token) return;
    await sendPushNotification({
      to: token,
      title: displayName || 'Рибар',
      body: `Реагира ${emoji} на твоята история`,
      data: { type: 'storyLike', storyId, actorUid: uid, actorName: displayName },
    });
  })().catch(() => {});

  return reaction;
}

export async function getStoryReactionSummary(storyId: string): Promise<StoryReactionSummary[]> {
  const fb = requireFirebase();
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
  const fb = requireFirebase();
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
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(fb.db, 'stories', storyId, 'comments'), {
    authorUid,
    authorName: (authorName || 'Рибар').slice(0, 120),
    text: trimmed.slice(0, 500),
    createdAt: serverTimestamp(),
  });

  void (async () => {
    const storySnap = await getDoc(doc(fb.db, 'stories', storyId));
    if (!storySnap.exists()) return;
    const ownerUid = storySnap.data()?.uid as string | undefined;
    if (!ownerUid || ownerUid === authorUid) return;
    await addDoc(collection(fb.db, 'users', ownerUid, 'notifications'), {
      actorUid: authorUid, actorName: (authorName || 'Рибар').slice(0, 120), type: 'storyComment', storyId, preview: trimmed.slice(0, 200), read: false, createdAt: serverTimestamp(),
    });
    const token = await getUserPushToken(ownerUid);
    if (!token) return;
    await sendPushNotification({
      to: token,
      title: authorName || 'Рибар',
      body: `Коментира историята ти: ${trimmed.slice(0, 80)}`,
      data: { type: 'storyComment', storyId, actorUid: authorUid, actorName: authorName },
    });
  })().catch(() => {});
}

export async function deleteStoryComment(storyId: string, commentId: string): Promise<void> {
  const fb = requireFirebase();
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
