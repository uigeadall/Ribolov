import { useState, useEffect } from 'react';
import { getUserPublicSummary } from '../services/userProfile';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { url: string; fetchedAt: number }>();

function getCached(uid: string): string | undefined {
  const entry = cache.get(uid);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > TTL_MS) { cache.delete(uid); return undefined; }
  return entry.url;
}

function setCached(uid: string, url: string): void {
  cache.set(uid, { url, fetchedAt: Date.now() });
}

/**
 * Resolves an avatar URL for a feed post author.
 * Priority: own photo > stored ownerPhotoUrl > lazy Firestore fetch (cached 5 min).
 */
export function useAvatarUrl({
  ownerUid,
  isMine,
  myPhotoUrl,
  resolvedAvatarUrl,
  ownerPhotoUrl,
}: {
  ownerUid: string;
  isMine: boolean;
  myPhotoUrl?: string;
  resolvedAvatarUrl?: string;
  ownerPhotoUrl?: string;
}): string {
  const storedAvatar = resolvedAvatarUrl?.trim() || ownerPhotoUrl?.trim();
  const myAvatar = myPhotoUrl?.trim() || '';
  const [fetchedAvatar, setFetchedAvatar] = useState<string>(() => getCached(ownerUid) ?? '');

  useEffect(() => {
    // Skip the lookup only when we already have something to show.
    // Previously this short-circuited whenever `isMine` was true, which
    // left the user's own posts blank if `myPhotoUrl` happened to be empty
    // (e.g. data: URL avatars don't get written to Firebase Auth.photoURL).
    if (storedAvatar) return;
    if (isMine && myAvatar) return;
    const cached = getCached(ownerUid);
    if (cached) { setFetchedAvatar(cached); return; }
    setFetchedAvatar('');
    getUserPublicSummary(ownerUid)
      .then((s) => {
        const p = s?.photoUrl?.trim();
        if (p) { setCached(ownerUid, p); setFetchedAvatar(p); }
      })
      .catch(() => {});
  }, [ownerUid, isMine, storedAvatar, myAvatar]);

  return (isMine ? myAvatar : '') || storedAvatar || fetchedAvatar || '';
}
