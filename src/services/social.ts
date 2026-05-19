import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { getBlockedUids } from './blockUser';
import { getUserPublicSummary } from './userProfile';

const FOLLOWING_TTL_MS = 10 * 60 * 1000;
const followingCache = new Map<string, { data: { uid: string; displayName: string }[]; at: number }>();

export async function getFollowerCount(targetUid: string): Promise<number> {
  const fb = requireFirebase();
  if (!targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'followers'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function getFollowingCount(targetUid: string): Promise<number> {
  const fb = requireFirebase();
  if (!targetUid) return 0;
  try {
    const agg = await getCountFromServer(collection(fb.db, 'users', targetUid, 'following'));
    return agg.data().count;
  } catch {
    return 0;
  }
}

export async function isFollowingUser(myUid: string, targetUid: string): Promise<boolean> {
  const fb = requireFirebase();
  if (!myUid || !targetUid) return false;
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'following', targetUid));
  return snap.exists();
}

export async function followUser(myUid: string, targetUid: string, targetName?: string) {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.set(
    doc(fb.db, 'users', myUid, 'following', targetUid),
    stripUndefinedForFirestore({ uid: targetUid, displayName: targetName ?? '', createdAt: serverTimestamp() }),
  );
  batch.set(
    doc(fb.db, 'users', targetUid, 'followers', myUid),
    stripUndefinedForFirestore({ uid: myUid, createdAt: serverTimestamp() }),
  );
  await batch.commit();
  followingCache.delete(myUid);
  suggestionsCache.delete(myUid);
}

export async function unfollowUser(myUid: string, targetUid: string) {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'users', myUid, 'following', targetUid));
  batch.delete(doc(fb.db, 'users', targetUid, 'followers', myUid));
  await batch.commit();
  followingCache.delete(myUid);
  suggestionsCache.delete(myUid);
}

export async function getFollowing(myUid: string) {
  const cached = followingCache.get(myUid);
  if (cached && Date.now() - cached.at < FOLLOWING_TTL_MS) return cached.data;
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'users', myUid, 'following'));
  const data = snap.docs.map((d) => {
    const d2 = d.data() as { uid?: string; displayName?: string };
    return { uid: d.id, displayName: d2.displayName ?? '' };
  });
  followingCache.set(myUid, { data, at: Date.now() });
  return data;
}

export async function isMutualFollow(myUid: string, otherUid: string): Promise<boolean> {
  const fb = requireFirebase();
  if (!myUid || !otherUid || myUid === otherUid) return false;
  const [mine, theirs] = await Promise.all([
    getDoc(doc(fb.db, 'users', myUid, 'following', otherUid)),
    getDoc(doc(fb.db, 'users', otherUid, 'following', myUid)),
  ]);
  return mine.exists() && theirs.exists();
}

// ─── People you may know ────────────────────────────────────────────────────

export type SuggestedUser = {
  uid: string;
  displayName: string;
  photoUrl?: string;
  /** Number of mutual follows (friends-of-friends count). */
  mutualCount: number;
};

const SUGGESTIONS_TTL_MS = 10 * 60 * 1000;
const suggestionsCache = new Map<string, { data: SuggestedUser[]; at: number }>();

export function invalidatePeopleSuggestions(myUid: string): void {
  suggestionsCache.delete(myUid);
}

/**
 * "People you may know" — friends-of-friends. Looks at who the user's existing
 * follows are following, ranks by overlap count, filters out self / already-following / blocked.
 * Cached per-user for 10 minutes.
 */
export async function suggestPeopleToFollow(myUid: string, maxResults = 8): Promise<SuggestedUser[]> {
  if (!myUid) return [];
  const cached = suggestionsCache.get(myUid);
  if (cached && Date.now() - cached.at < SUGGESTIONS_TTL_MS) return cached.data;

  const fb = requireFirebase();
  const [myFollowing, blockedUids] = await Promise.all([
    getFollowing(myUid),
    getBlockedUids(myUid).catch(() => new Set<string>()),
  ]);
  const myFollowingSet = new Set(myFollowing.map((f) => f.uid));

  // Walk a sample of my follows — chunked so we don't fan out too aggressively.
  const SAMPLE_LIMIT = 12;
  const sample = myFollowing.slice(0, SAMPLE_LIMIT);

  const mutualMap = new Map<string, { count: number; displayName: string }>();
  await Promise.all(
    sample.map(async (f) => {
      try {
        const snap = await getDocs(
          query(collection(fb.db, 'users', f.uid, 'following'), limit(20)),
        );
        snap.docs.forEach((d) => {
          const uid = d.id;
          if (uid === myUid) return;
          if (myFollowingSet.has(uid)) return;
          if (blockedUids.has(uid)) return;
          const dn = (d.data()?.displayName as string | undefined)?.trim() || 'Рибар';
          const prev = mutualMap.get(uid);
          if (prev) prev.count++;
          else mutualMap.set(uid, { count: 1, displayName: dn });
        });
      } catch { /* ignore one bad follow */ }
    }),
  );

  // Rank by overlap, then hydrate photo from /users/{uid}.
  const ranked = [...mutualMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxResults);

  const hydrated = await Promise.all(
    ranked.map(async ([uid, info]) => {
      const summary = await getUserPublicSummary(uid).catch(() => null);
      return {
        uid,
        displayName: summary?.displayName?.trim() || info.displayName || 'Рибар',
        photoUrl: summary?.photoUrl?.trim() || undefined,
        mutualCount: info.count,
      } satisfies SuggestedUser;
    }),
  );

  suggestionsCache.set(myUid, { data: hydrated, at: Date.now() });
  return hydrated;
}

// ─── Featured angler of the week ────────────────────────────────────────────

export type FeaturedAngler = {
  uid: string;
  displayName: string;
  photoUrl?: string;
  city?: string;
  bio?: string;
  publicCount: number;
};

const FEATURED_TTL_MS = 60 * 60 * 1000;
let featuredCache: { data: FeaturedAngler | null; at: number } | null = null;

/**
 * Picks the user with the most public catches in the last 7 days.
 * Cached app-wide for 1 hour.
 */
export async function getFeaturedAnglerOfWeek(excludeUid?: string): Promise<FeaturedAngler | null> {
  if (featuredCache && Date.now() - featuredCache.at < FEATURED_TTL_MS) {
    // If the cached pick is the current user, fall through and recompute with excludeUid honored.
    if (!excludeUid || featuredCache.data?.uid !== excludeUid) return featuredCache.data;
  }

  const fb = requireFirebase();
  const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString();

  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'publicCatches'),
        where('date', '>=', sinceIso),
        orderBy('date', 'desc'),
        limit(200),
      ),
    );
    const counts = new Map<string, { count: number; name: string }>();
    for (const d of snap.docs) {
      const data = d.data() as { ownerUid?: string; ownerName?: string };
      const uid = data.ownerUid;
      if (!uid || uid === excludeUid) continue;
      const prev = counts.get(uid);
      if (prev) prev.count++;
      else counts.set(uid, { count: 1, name: data.ownerName ?? 'Рибар' });
    }
    const top = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    if (!top) {
      featuredCache = { data: null, at: Date.now() };
      return null;
    }
    const [uid, info] = top;
    const summary = await getUserPublicSummary(uid).catch(() => null);
    const result: FeaturedAngler = {
      uid,
      displayName: summary?.displayName?.trim() || info.name || 'Рибар',
      photoUrl: summary?.photoUrl?.trim() || undefined,
      city: summary?.city,
      bio: summary?.bio,
      publicCount: info.count,
    };
    featuredCache = { data: result, at: Date.now() };
    return result;
  } catch {
    return null;
  }
}
