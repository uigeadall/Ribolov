import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
  where,
  startAfter,
  serverTimestamp,
  increment,
  runTransaction,
  onSnapshot,
  updateDoc,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { uploadLocalPhotoToStorage, waitForResizedUrl } from './catchSync';
import { extractHashtags } from '../utils/textTokens';
import { allowComment, allowPostCreate } from './socialRateLimit';
import { notifyInteraction, sendMentionNotifications } from './socialNotifications';
import type { FeedComment } from './socialTypes';
import type { Post, ResharedRef } from '../types';

const POSTS_COLLECTION = 'posts';

export type CreatePostInput = {
  ownerUid: string;
  ownerName: string;
  ownerPhotoUrl?: string;
  text: string;
  /** Local file:// URI — uploaded to Storage before the doc is written. Optional. */
  localPhotoUri?: string;
  /** Already-resolved UIDs of @mentioned users. */
  mentionUids: string[];
  /** If set, this post is a quote-reshare of another feed item. */
  reshareOf?: ResharedRef;
};

export type PostsPage = {
  items: Post[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
};

function isRemote(uri?: string): boolean {
  return !!uri && /^https?:\/\//i.test(uri.trim());
}

function newPostId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates a public post. If a local photo URI is supplied it's uploaded to
 * Firebase Storage first; the resulting download URL goes on the post doc.
 * Hashtags are extracted from the text and stored lowercase for filtering.
 */
export async function createPost(input: CreatePostInput): Promise<string> {
  if (!allowPostCreate(input.ownerUid)) {
    throw new Error('Твърде много публикации за кратко време. Опитай по-късно.');
  }
  const fb = requireFirebase();
  const id = newPostId();
  const text = (input.text || '').trim();
  if (!text && !input.localPhotoUri && !input.reshareOf) {
    throw new Error('Постът трябва да съдържа текст или снимка.');
  }

  let photoUri: string | undefined;
  let photoStoragePath: string | undefined;
  if (input.localPhotoUri && !isRemote(input.localPhotoUri)) {
    const extMatch = input.localPhotoUri.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    photoStoragePath = `publicCatchPhotos/${input.ownerUid}/posts/${id}_${Date.now()}.${ext}`;
    const rawUrl = await uploadLocalPhotoToStorage(fb, input.localPhotoUri, photoStoragePath);
    // The "Resize Images" extension deletes the original after writing the
    // `_1200x1200.webp` variant, so the raw upload URL 404s within seconds.
    // Wait for the variant and use its tokenized download URL instead — same
    // approach as catches in ensureCatchPhotoUploadedForCloud.
    const resizedUrl = await waitForResizedUrl(fb.storage, photoStoragePath, '_1200x1200');
    photoUri = resizedUrl ?? rawUrl;
  } else if (input.localPhotoUri && isRemote(input.localPhotoUri)) {
    photoUri = input.localPhotoUri;
  }

  const hashtags = extractHashtags(text);

  const payload: Post = {
    id,
    ownerUid: input.ownerUid,
    ownerName: input.ownerName.slice(0, 120) || 'Рибар',
    ownerPhotoUrl: input.ownerPhotoUrl,
    text: text.slice(0, 2000),
    photoUri,
    photoStoragePath,
    hashtags,
    mentionUids: [...new Set(input.mentionUids)],
    date: new Date().toISOString(),
    isPublic: true,
    likeCount: 0,
    commentCount: 0,
    reshareOf: input.reshareOf,
  };

  await setDoc(
    doc(fb.db, POSTS_COLLECTION, id),
    stripUndefinedForFirestore({ ...payload, createdAt: serverTimestamp() }),
  );

  // Fire-and-forget: notify every mentioned user. Self-mentions and dupes are
  // filtered inside sendMentionNotifications.
  if (payload.mentionUids.length > 0) {
    sendMentionNotifications(
      payload.mentionUids,
      input.ownerUid,
      payload.ownerName,
      id,
      text || '',
    ).catch(() => {});
  }

  return id;
}

export async function fetchPublicPosts(
  maxItems = 20,
  afterDoc?: DocumentSnapshot | null,
  ownerUids?: string[],
): Promise<PostsPage> {
  const fb = requireFirebase();

  // Firestore 'in' is capped at 30 values — chunk if needed.
  if (ownerUids && ownerUids.length > 30) {
    const all: Post[] = [];
    const CHUNK = 30;
    for (let i = 0; i < ownerUids.length; i += CHUNK) {
      const chunk = ownerUids.slice(i, i + CHUNK);
      const snap = await getDocs(
        query(
          collection(fb.db, POSTS_COLLECTION),
          where('ownerUid', 'in', chunk),
          orderBy('date', 'desc'),
          limit(maxItems + 1),
        ),
      );
      snap.docs.forEach((d) => all.push(d.data() as Post));
    }
    all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return {
      items: all.slice(0, maxItems),
      lastDoc: null,
      hasMore: all.length > maxItems,
    };
  }

  const constraints: Parameters<typeof query>[1][] = [
    orderBy('date', 'desc'),
    limit(maxItems + 1),
  ];
  if (ownerUids && ownerUids.length > 0) {
    constraints.unshift(where('ownerUid', 'in', ownerUids));
  }
  if (afterDoc) constraints.push(startAfter(afterDoc));

  const snap = await getDocs(query(collection(fb.db, POSTS_COLLECTION), ...constraints));
  const hasMore = snap.docs.length > maxItems;
  const docs = hasMore ? snap.docs.slice(0, maxItems) : snap.docs;
  return {
    items: docs.map((d) => d.data() as Post),
    lastDoc: docs[docs.length - 1] ?? null,
    hasMore,
  };
}

/**
 * Fetches both catches and posts tagged with `hashtag`, sorted newest-first.
 * Hashtags are normalised to lowercase.
 */
export async function fetchPostsByHashtag(hashtag: string, maxItems = 40): Promise<Post[]> {
  const fb = requireFirebase();
  const tag = hashtag.toLowerCase().trim();
  if (!tag) return [];
  const snap = await getDocs(
    query(
      collection(fb.db, POSTS_COLLECTION),
      where('hashtags', 'array-contains', tag),
      orderBy('date', 'desc'),
      limit(maxItems),
    ),
  );
  return snap.docs.map((d) => d.data() as Post);
}

export async function getPost(id: string): Promise<Post | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, POSTS_COLLECTION, id));
  return snap.exists() ? (snap.data() as Post) : null;
}

/**
 * Subscribe to comments on a post (chronological, capped at 80).
 */
export function subscribePostComments(postId: string, onNext: (comments: FeedComment[]) => void): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, POSTS_COLLECTION, postId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(80),
  );
  return onSnapshot(q, (snap) => {
    onNext(
      snap.docs.map((d) => {
        const data = d.data() as {
          authorUid: string;
          authorName: string;
          text: string;
          createdAt?: unknown;
          editedAt?: unknown;
          replyToId?: string;
          replyToName?: string;
          likeCount?: number;
        };
        return {
          id: d.id,
          authorUid: data.authorUid,
          authorName: data.authorName,
          text: data.text,
          createdAt: data.createdAt,
          editedAt: data.editedAt,
          replyToId: data.replyToId,
          replyToName: data.replyToName,
          likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
        };
      }),
    );
  }, () => onNext([]));
}

/** Subscribes to whether the current user has liked a specific post comment. */
export function subscribePostCommentLike(
  postId: string,
  commentId: string,
  myUid: string,
  cb: (liked: boolean) => void,
): () => void {
  const fb = requireFirebase();
  return onSnapshot(
    doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId, 'likes', myUid),
    (snap) => cb(snap.exists()),
  );
}

/** One-shot fetch: has the current user liked this post comment? Used by
    `CommentLikeButton` instead of subscribing per comment. */
export async function fetchPostCommentLike(
  postId: string,
  commentId: string,
  myUid: string,
): Promise<boolean> {
  const fb = requireFirebase();
  const snap = await getDoc(
    doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId, 'likes', myUid),
  );
  return snap.exists();
}

/** @deprecated Heart-only path. Use `togglePostCommentReaction` for multi-emoji. */
export async function togglePostCommentLike(
  postId: string,
  commentId: string,
  myUid: string,
  myDisplayName: string,
): Promise<boolean> {
  const r = await togglePostCommentReaction(postId, commentId, myUid, myDisplayName, 'heart');
  return r !== null;
}

/** Read the current user's reaction on a post comment (null = none). */
export async function fetchMyPostCommentReaction(
  postId: string,
  commentId: string,
  myUid: string,
): Promise<import('./socialTypes').ReactionType | null> {
  const fb = requireFirebase();
  const snap = await getDoc(
    doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId, 'likes', myUid),
  );
  if (!snap.exists()) return null;
  const r = snap.data()?.reaction as import('./socialTypes').ReactionType | undefined;
  return r ?? 'heart';
}

/** Toggle or change a reaction on a post comment. Mirror of the catch-comment
    reaction path. Count only moves on reacted ↔ none transitions; switching
    from one emoji to another is count-neutral. */
export async function togglePostCommentReaction(
  postId: string,
  commentId: string,
  myUid: string,
  myDisplayName: string,
  reaction: import('./socialTypes').ReactionType,
): Promise<import('./socialTypes').ReactionType | null> {
  const fb = requireFirebase();
  const likeRef = doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId, 'likes', myUid);
  const commentRef = doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId);
  return runTransaction(fb.db, async (txn) => {
    const snap = await txn.get(likeRef);
    const existing = snap.exists()
      ? ((snap.data()?.reaction as import('./socialTypes').ReactionType | undefined) ?? 'heart')
      : null;

    if (existing === reaction) {
      txn.delete(likeRef);
      txn.update(commentRef, { likeCount: increment(-1) });
      return null;
    }
    txn.set(likeRef, stripUndefinedForFirestore({
      createdAt: serverTimestamp(),
      displayName: (myDisplayName || 'Рибар').slice(0, 120),
      reaction,
    }));
    if (existing === null) {
      txn.update(commentRef, { likeCount: increment(1) });
    }
    return reaction;
  });
}

export async function addPostComment(
  postId: string,
  authorUid: string,
  authorName: string,
  text: string,
  replyTo?: { id: string; name: string },
): Promise<void> {
  if (!allowComment(authorUid)) {
    throw new Error('Твърде много коментари за кратко време. Опитай по-късно.');
  }
  const fb = requireFirebase();
  const trimmed = text.trim();
  if (!trimmed) return;

  // Look up the post owner now (cheap — single get) so we know whether to
  // send a notification. We avoid a second round trip later.
  let ownerUid: string | undefined;
  try {
    const snap = await getDoc(doc(fb.db, POSTS_COLLECTION, postId));
    if (snap.exists()) ownerUid = snap.data()?.ownerUid as string | undefined;
  } catch { /* ignore */ }

  await addDoc(
    collection(fb.db, POSTS_COLLECTION, postId, 'comments'),
    stripUndefinedForFirestore({
      authorUid,
      authorName: authorName || 'Рибар',
      text: trimmed.slice(0, 2000),
      createdAt: serverTimestamp(),
      ...(replyTo ? { replyToId: replyTo.id, replyToName: replyTo.name } : {}),
    }),
  );

  // Bump the post's commentCount so the badge stays in sync without a re-read.
  // Best-effort: if this fails (e.g. rules), comments still saved.
  updateDoc(doc(fb.db, POSTS_COLLECTION, postId), { commentCount: increment(1) }).catch(() => {});

  // Fire-and-forget notification — only when commenter ≠ owner. We piggy-back
  // on the existing catch-comment notification shape (storing postId in the
  // catchId slot) so NotificationsScreen renders it the same way. Navigation
  // from the notification still goes to the catch detail screen, which
  // gracefully shows "not found" — not ideal but acceptable until the
  // notifications service grows a separate postId field.
  if (ownerUid) {
    notifyInteraction({
      recipientUid: ownerUid,
      actorUid: authorUid,
      actorName: (authorName || 'Рибар').slice(0, 120),
      type: 'comment',
      catchId: postId,
      preview: trimmed.slice(0, 120),
    }).catch(() => {});
  }
}

export async function editPostComment(postId: string, commentId: string, newText: string): Promise<void> {
  const fb = requireFirebase();
  const trimmed = newText.trim();
  if (!trimmed) throw new Error('Текстът не може да е празен.');
  await updateDoc(doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId), {
    text: trimmed.slice(0, 2000),
    editedAt: serverTimestamp(),
  });
}

export async function deletePostComment(postId: string, commentId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, POSTS_COLLECTION, postId, 'comments', commentId));
  // Best-effort decrement
  updateDoc(doc(fb.db, POSTS_COLLECTION, postId), { commentCount: increment(-1) }).catch(() => {});
}

/**
 * @deprecated Use `subscribeMyReactionOnPost` from `socialReactions.ts`.
 * Subscribe to whether the current user has liked a post.
 */
export function subscribePostLike(postId: string, myUid: string, cb: (liked: boolean) => void): () => void {
  const fb = requireFirebase();
  return onSnapshot(doc(fb.db, POSTS_COLLECTION, postId, 'likes', myUid), (snap) => cb(snap.exists()));
}

/**
 * @deprecated Use `togglePostReaction` from `socialReactions.ts` for multi-emoji
 *   reactions. This heart-only path is kept for any straggling callers.
 * Toggles a heart-like on a post. Returns the new liked state.
 * Maintains the post's `likeCount` via transaction.
 */
export async function togglePostLike(postId: string, myUid: string, actorName: string): Promise<boolean> {
  const fb = requireFirebase();
  const likeRef = doc(fb.db, POSTS_COLLECTION, postId, 'likes', myUid);
  const postRef = doc(fb.db, POSTS_COLLECTION, postId);
  return runTransaction(fb.db, async (txn) => {
    const snap = await txn.get(likeRef);
    if (snap.exists()) {
      txn.delete(likeRef);
      txn.update(postRef, { likeCount: increment(-1) });
      return false;
    }
    txn.set(likeRef, stripUndefinedForFirestore({
      createdAt: serverTimestamp(),
      displayName: (actorName || 'Рибар').slice(0, 120),
    }));
    txn.update(postRef, { likeCount: increment(1) });
    return true;
  });
}

/**
 * Deletes a post and its photo. Best-effort on the Storage file.
 */
export async function deletePost(postId: string): Promise<void> {
  const fb = requireFirebase();
  let storagePath: string | undefined;
  try {
    const snap = await getDoc(doc(fb.db, POSTS_COLLECTION, postId));
    if (snap.exists()) storagePath = snap.data()?.photoStoragePath as string | undefined;
  } catch { /* ignore */ }
  await deleteDoc(doc(fb.db, POSTS_COLLECTION, postId)).catch(() => {});
  if (storagePath) {
    await deleteObject(ref(fb.storage, storagePath)).catch(() => {});
  }
}
