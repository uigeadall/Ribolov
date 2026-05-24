import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { allowLikeToggle, allowTournamentEntry } from './socialRateLimit';
import { logEvent } from './analytics';
import type { Tournament } from '../types';

export async function createTournament(t: Tournament) {
  const fb = requireFirebase();
  const raw = { ...t, createdAt: serverTimestamp() } as Record<string, unknown>;
  await setDoc(doc(fb.db, 'tournaments', t.id), stripUndefinedForFirestore(raw), { merge: true });
}

export async function isJoinedTournament(tournamentId: string, uid: string): Promise<boolean> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'users', uid, 'joinedTournaments', tournamentId));
  return snap.exists();
}

export async function joinTournament(tournamentId: string, uid: string, displayName: string) {
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'users', uid, 'joinedTournaments', tournamentId),
    stripUndefinedForFirestore({ tournamentId, displayName, joinedAt: serverTimestamp() })
  );
  await setDoc(
    doc(fb.db, 'tournaments', tournamentId, 'participants', uid),
    stripUndefinedForFirestore({ uid, displayName, joinedAt: serverTimestamp() }),
    { merge: true }
  );
  logEvent('tournament_joined', { tournament_id: tournamentId });
}

export type TournamentPhotoEntry = {
  id: string;
  ownerUid: string;
  ownerName: string;
  photoUri: string;
  speciesName?: string;
  catchId: string;
  likeCount: number;
  submittedAt?: unknown;
};

export async function submitCatchToTournament(
  tournamentId: string,
  entry: Omit<TournamentPhotoEntry, 'id' | 'likeCount' | 'submittedAt'>
): Promise<void> {
  if (!allowTournamentEntry(entry.ownerUid)) {
    throw new Error('Твърде много заявки за кратко време. Опитай по-късно.');
  }
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entry.ownerUid),
    stripUndefinedForFirestore({ ...entry, likeCount: 0, submittedAt: serverTimestamp() }),
    { merge: true }
  );
  invalidatePhotoEntries(tournamentId);
}

// Short-lived in-memory cache of photo-entries per tournament. TournamentsScreen
// fans out one fetch per joined tournament every time the tab gets focus — for
// a user joined to 20+ tournaments that's 20 Firestore reads per re-focus. The
// rank can shift between sessions but doesn't need second-by-second freshness.
const PHOTO_ENTRIES_TTL_MS = 60_000;
const photoEntriesCache = new Map<string, { entries: TournamentPhotoEntry[]; expiresAt: number }>();

/** Drop the cached entries for a tournament so the next fetch goes to
    Firestore. Called after mutations that change ranking (new submission,
    like toggle) so the user sees fresh standings. */
function invalidatePhotoEntries(tournamentId: string) {
  photoEntriesCache.delete(tournamentId);
}

/** Nukes the entire photo-entries cache. Called on sign-out so user B
    doesn't briefly see user A's cached tournament data (would be visible
    until the 60s TTL expires otherwise). Exported as a named function
    rather than reaching into the Map directly so the cache shape can
    evolve without authContext having to know about it. */
export function resetTournamentCaches(): void {
  photoEntriesCache.clear();
}

export async function fetchTournamentPhotoEntries(
  tournamentId: string
): Promise<TournamentPhotoEntry[]> {
  const cached = photoEntriesCache.get(tournamentId);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const fb = requireFirebase();
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'tournaments', tournamentId, 'photoEntries'),
        orderBy('likeCount', 'desc'),
        limit(50)
      )
    );
    const entries = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<TournamentPhotoEntry, 'id'>),
    }));
    photoEntriesCache.set(tournamentId, {
      entries,
      expiresAt: Date.now() + PHOTO_ENTRIES_TTL_MS,
    });
    return entries;
  } catch {
    return [];
  }
}

export async function toggleTournamentEntryLike(
  tournamentId: string,
  entryId: string,
  uid: string
): Promise<boolean> {
  if (!allowLikeToggle(uid)) {
    throw new Error('Твърде често — опитай отново след секунда.');
  }
  const fb = requireFirebase();
  const likeRef = doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entryId, 'likes', uid);
  const entryRef = doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entryId);
  const likeSnap = await getDoc(likeRef);
  // Like toggles reorder the ranking — invalidate so the next fetch reflects
  // the new likeCount rather than a stale 60s-old snapshot.
  invalidatePhotoEntries(tournamentId);
  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    // Await the counter increment so a user who backgrounds the app right
    // after liking doesn't lose the write. The screen's optimistic counter
    // bump has already given them instant feedback; this only changes when
    // toggleTournamentEntryLike's promise resolves.
    await updateDoc(entryRef, { likeCount: increment(-1) });
    return false;
  }
  await setDoc(likeRef, { uid, likedAt: serverTimestamp() });
  await updateDoc(entryRef, { likeCount: increment(1) });
  return true;
}

/** Tournaments the user hosts OR has joined. Merged + de-duped, sorted by
    endDate (active first, then upcoming, then ended). Used by TournamentsScreen
    "My tournaments" section. */
export async function fetchMyTournaments(uid: string): Promise<Tournament[]> {
  if (!uid) return [];
  const fb = requireFirebase();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Hosted: a single index-friendly query on hostUid.
  const hostedPromise = (async () => {
    try {
      const snap = await getDocs(
        query(collection(fb.db, 'tournaments'), where('hostUid', '==', uid), orderBy('endDate', 'desc'), limit(50))
      );
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) }));
    } catch {
      return [];
    }
  })();

  // Joined: read the subcollection, then hydrate the tournament docs in chunks.
  const joinedPromise = (async () => {
    let joinSnap;
    try {
      joinSnap = await getDocs(collection(fb.db, 'users', uid, 'joinedTournaments'));
    } catch {
      return [];
    }
    const ids = joinSnap.docs.map((d) => d.id);
    if (ids.length === 0) return [];
    const out: Tournament[] = [];
    const CHUNK = 30;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const snap = await getDocs(
          query(collection(fb.db, 'tournaments'), where(documentId(), 'in', chunk))
        );
        for (const d of snap.docs) {
          out.push({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) });
        }
      } catch {
        // ignore chunk failures
      }
    }
    return out;
  })();

  const [hosted, joined] = await Promise.all([hostedPromise, joinedPromise]);
  // Dedupe — a host is auto-joined to their own tournament.
  const byId = new Map<string, Tournament>();
  for (const t of hosted) byId.set(t.id, t);
  for (const t of joined) if (!byId.has(t.id)) byId.set(t.id, t);

  // Sort: active first (endDate >= today), soonest-ending. Then past, most recent first.
  const all = Array.from(byId.values());
  all.sort((a, b) => {
    const aActive = (a.endDate ?? '') >= todayIso;
    const bActive = (b.endDate ?? '') >= todayIso;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) return (a.endDate ?? '').localeCompare(b.endDate ?? ''); // soonest end first
    return (b.endDate ?? '').localeCompare(a.endDate ?? ''); // most-recent past first
  });
  return all;
}

/** Public tournaments anyone can browse. Filters out ones that have already ended
    and ones explicitly marked isPublic === false. */
export async function fetchPublicTournaments(maxItems = 50): Promise<Tournament[]> {
  const fb = requireFirebase();
  const todayIso = new Date().toISOString().slice(0, 10);
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'tournaments'),
        where('endDate', '>=', todayIso),
        orderBy('endDate', 'asc'),
        limit(maxItems),
      )
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) }))
      // isPublic defaults to true if missing (older docs predate the flag).
      .filter((t) => t.isPublic !== false);
  } catch {
    return [];
  }
}

/** Returns the tournaments the user has joined whose endDate is today or later,
    sorted by soonest-ending first. Used by the Home screen "Today" hub to show
    a live countdown to the next deadline. */
export async function fetchMyActiveTournaments(uid: string): Promise<Tournament[]> {
  if (!uid) return [];
  const fb = requireFirebase();
  // Read the user's joinedTournaments subcollection — small (subscriber side),
  // bounded by however many tournaments the user is actually in.
  let joinSnap;
  try {
    joinSnap = await getDocs(collection(fb.db, 'users', uid, 'joinedTournaments'));
  } catch {
    return [];
  }
  const ids = joinSnap.docs.map((d) => d.id);
  if (ids.length === 0) return [];

  // Hydrate tournament docs in chunks of 30 — Firestore's `in` limit.
  const todayIso = new Date().toISOString().slice(0, 10);
  const results: Tournament[] = [];
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const snap = await getDocs(
        query(collection(fb.db, 'tournaments'), where(documentId(), 'in', chunk))
      );
      for (const d of snap.docs) {
        const t = { id: d.id, ...(d.data() as Omit<Tournament, 'id'>) };
        // Keep tournaments that haven't ended yet — string comparison works for
        // ISO-formatted YYYY-MM-DD dates.
        if (!t.endDate || t.endDate >= todayIso) results.push(t);
      }
    } catch {
      // ignore chunk failures — partial result is still useful
    }
  }
  results.sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));
  return results;
}

/** A user's standing within a tournament. `rank` is null when the user
    hasn't submitted a photo entry yet (they joined but didn't compete).
    `total` is the number of competing entries — i.e. participants who
    actually submitted. Ranking matches the photoEntries leaderboard,
    which is ordered by `likeCount` desc. */
export type MyTournamentRank = {
  rank: number | null;
  total: number;
};

/** Fetches the current user's standing in a tournament. Best-effort — on
    any Firestore error this returns `{ rank: null, total: 0 }` so the
    caller can silently skip rendering the rank pill.

    Implementation: directly reads the user's own photoEntry doc (keyed by
    ownerUid — see submitCatchToTournament) and counts entries with strictly
    more likes. The earlier version walked the top-50 leaderboard, which
    silently dropped users ranked 51+ to `rank: null` even though they had
    actually submitted. */
export async function fetchMyTournamentRank(
  tournamentId: string,
  uid: string
): Promise<MyTournamentRank> {
  if (!tournamentId || !uid) return { rank: null, total: 0 };
  const fb = requireFirebase();
  try {
    const entriesCol = collection(fb.db, 'tournaments', tournamentId, 'photoEntries');
    const myEntrySnap = await getDoc(doc(entriesCol, uid));
    // Total competing entries — accurate regardless of leaderboard depth.
    const totalSnap = await getCountFromServer(entriesCol);
    const total = totalSnap.data().count;
    if (!myEntrySnap.exists()) return { rank: null, total };
    const myLikeCount = (myEntrySnap.data()?.likeCount as number | undefined) ?? 0;
    // Rank = 1 + (entries with strictly more likes). Same-tie users share a
    // rank window — acceptable for a leaderboard with no canonical tiebreak.
    const aboveSnap = await getCountFromServer(
      query(entriesCol, where('likeCount', '>', myLikeCount))
    );
    const rank = aboveSnap.data().count + 1;
    return { rank, total };
  } catch {
    return { rank: null, total: 0 };
  }
}

export async function getMyLikedEntries(
  tournamentId: string,
  uid: string,
  entryIds: string[]
): Promise<Set<string>> {
  const fb = requireFirebase();
  const results = await Promise.all(
    entryIds.map((id) =>
      getDoc(doc(fb.db, 'tournaments', tournamentId, 'photoEntries', id, 'likes', uid))
    )
  );
  const liked = new Set<string>();
  results.forEach((snap, i) => { if (snap.exists()) liked.add(entryIds[i]); });
  return liked;
}
