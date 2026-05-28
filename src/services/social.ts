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
  documentId,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { getBlockedUids } from './blockUser';
import { getUserPublicSummary } from './userProfile';
import { allowFollowAction } from './socialRateLimit';
import { logEvent } from './analytics';

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
  if (!allowFollowAction(myUid)) {
    throw new Error('Твърде много действия за кратко време. Опитай по-късно.');
  }
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
  logEvent('friend_followed');
}

export async function unfollowUser(myUid: string, targetUid: string) {
  if (!allowFollowAction(myUid)) {
    throw new Error('Твърде много действия за кратко време. Опитай по-късно.');
  }
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

/** Returns the uids of everyone who follows `theirUid`, capped to keep
    the read bounded. Used by personalBest fan-out so a friend's PB lights
    your bell. A viral angler's follower list can be huge; the cap is a
    deliberate trade-off (most-recent followers get the notification). */
export async function getFollowerUids(theirUid: string, maxRead = 200): Promise<string[]> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(collection(fb.db, 'users', theirUid, 'followers'), limit(maxRead)),
  );
  return snap.docs.map((d) => d.id);
}

/** Returns the people who follow `theirUid` AND whom `myUid` also follows
    (intersection of "their followers" ∩ "my following"). Used for the
    "Followed by @ivan, @stoyan and 4 others you follow" badge on public
    profiles. Capped at maxRead because a viral account's followers
    subcollection could be huge — undercount is fine since the badge says
    "and N others" anyway. */
export async function listMutualFollowers(
  myUid: string,
  theirUid: string,
  maxRead = 200,
): Promise<{ uid: string; displayName: string }[]> {
  if (!myUid || !theirUid || myUid === theirUid) return [];
  const fb = requireFirebase();
  const [myFollowing, theirFollowersSnap] = await Promise.all([
    getFollowing(myUid),
    getDocs(query(collection(fb.db, 'users', theirUid, 'followers'), limit(maxRead))),
  ]);
  if (myFollowing.length === 0 || theirFollowersSnap.empty) return [];
  const nameByUid = new Map(myFollowing.map((f) => [f.uid, f.displayName] as const));
  const out: { uid: string; displayName: string }[] = [];
  for (const d of theirFollowersSnap.docs) {
    const name = nameByUid.get(d.id);
    if (name != null) out.push({ uid: d.id, displayName: name });
  }
  return out;
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
  /** Number of friends-of-friends overlap. Zero for candidates that came from
      the fallback (recent active posters) — UI should show a different label
      in that case based on `reason`. */
  mutualCount: number;
  /** Why this user was suggested. `mutuals` = friends-of-friends graph match,
      `active` = fallback (recent public posters) used when the graph yields
      too few candidates. New users with zero follows see only `active`. */
  reason: 'mutuals' | 'active';
};

const SUGGESTIONS_TTL_MS = 10 * 60 * 1000;
const suggestionsCache = new Map<string, { data: SuggestedUser[]; at: number }>();

export function invalidatePeopleSuggestions(myUid: string): void {
  suggestionsCache.delete(myUid);
}

/** Batched profile read — one Firestore `in` query for up to 30 uids replaces
    N parallel `getDoc` calls. Used by `suggestPeopleToFollow` hydration. */
async function fetchProfilesBatch(uids: string[]): Promise<Map<string, { displayName?: string; photoUrl?: string }>> {
  const out = new Map<string, { displayName?: string; photoUrl?: string }>();
  if (uids.length === 0) return out;
  const fb = requireFirebase();
  // Firestore `in` query caps at 30 values. Our caller passes at most
  // `maxResults` (default 8) so this is a single round-trip in practice.
  // If a future caller needs more we'd chunk here.
  const capped = uids.slice(0, 30);
  try {
    const snap = await getDocs(
      query(collection(fb.db, 'users'), where(documentId(), 'in', capped)),
    );
    for (const d of snap.docs) {
      const data = d.data() as { displayName?: string; photoUrl?: string };
      out.set(d.id, {
        displayName: typeof data.displayName === 'string' ? data.displayName.trim() : undefined,
        photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl.trim() : undefined,
      });
    }
  } catch { /* network/permission failure — caller falls back to graph-side names */ }
  return out;
}

/**
 * "People you may know" — friends-of-friends graph walk with a fallback to
 * recent active public posters when the graph yields fewer than `maxResults`
 * candidates. New users (zero follows) get an all-fallback result so the row
 * isn't empty on first launch; users with a thin graph get a mix; heavy users
 * get pure graph results. Cached per-user for 10 minutes.
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

  // ── Graph pass: friends-of-friends overlap ────────────────────────────────
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

  const graphRanked = [...mutualMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxResults);

  // ── Fallback pass: top public-catch posters from the last 30 days ─────────
  // Fires when the graph alone doesn't fill `maxResults` — most importantly
  // for brand-new users who have nobody followed yet. Same data source as
  // `getFeaturedAnglerOfWeek` so we're not adding a new collection scan
  // pattern, just a longer window and a top-N instead of top-1.
  const remaining = maxResults - graphRanked.length;
  const fallbackEntries: { uid: string; count: number; displayName: string }[] = [];
  if (remaining > 0) {
    try {
      const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
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
        if (!uid) continue;
        if (uid === myUid) continue;
        if (myFollowingSet.has(uid)) continue;
        if (blockedUids.has(uid)) continue;
        if (mutualMap.has(uid)) continue; // already in graph result
        const prev = counts.get(uid);
        if (prev) prev.count++;
        else counts.set(uid, { count: 1, name: data.ownerName ?? 'Рибар' });
      }
      const topFallback = [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, remaining);
      for (const [uid, info] of topFallback) {
        fallbackEntries.push({ uid, count: info.count, displayName: info.name });
      }
    } catch { /* publicCatches scan failed — return graph-only result */ }
  }

  // ── Single batched hydration for graph + fallback together ────────────────
  const allUids = [...graphRanked.map(([uid]) => uid), ...fallbackEntries.map((e) => e.uid)];
  const profiles = await fetchProfilesBatch(allUids);

  const hydrated: SuggestedUser[] = [
    ...graphRanked.map(([uid, info]) => {
      const p = profiles.get(uid);
      return {
        uid,
        displayName: p?.displayName || info.displayName || 'Рибар',
        photoUrl: p?.photoUrl || undefined,
        mutualCount: info.count,
        reason: 'mutuals' as const,
      } satisfies SuggestedUser;
    }),
    ...fallbackEntries.map((e) => {
      const p = profiles.get(e.uid);
      return {
        uid: e.uid,
        displayName: p?.displayName || e.displayName || 'Рибар',
        photoUrl: p?.photoUrl || undefined,
        mutualCount: 0,
        reason: 'active' as const,
      } satisfies SuggestedUser;
    }),
  ];

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

/** Drop every entry from the in-memory social caches. Call this on sign-out so
    user B doesn't see user A's follow list (or suggestions / featured angler)
    on a shared device while A's TTL window is still active. */
export function resetSocialCaches(): void {
  followingCache.clear();
  suggestionsCache.clear();
  featuredCache = null;
}
