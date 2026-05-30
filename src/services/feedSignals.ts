/**
 * Persistent feed-personalisation signals.
 *
 * Stores three pieces of state in AsyncStorage:
 *   - hiddenAuthorUids: explicit "Hide this author" — never show their
 *     catches in For You.
 *   - notInterestedCatchIds: per-catch demotions from "Не ме интересува"
 *     in the ⋯ menu. Bounded; drops the oldest entries past the cap.
 *   - dwellByAuthorUid: per-author dwell time (rolling, time-decayed).
 *     Used as a positive signal in For You ranking — authors whose posts
 *     the user actually reads get a small score boost on future runs.
 *
 * All state is local and ephemeral by design (no Firestore writes per
 * scroll). Dwell aggregation is debounced/throttled in the consumer
 * (FeedScreen.tsx) so we write at most a few times per session, not
 * per visibility tick.
 *
 * Schema version embedded so future migrations can drop bad shapes
 * rather than blowing up on Object spread errors.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@ribolov/feedSignals';
const VERSION = 1;

const HIDDEN_AUTHORS_CAP = 500;
const NOT_INTERESTED_CAP = 2000;
const DWELL_AUTHORS_CAP = 200;

export type PersistedFeedSignals = {
  v: number;
  hiddenAuthorUids: string[];
  notInterestedCatchIds: string[];
  dwellByAuthorUid: Record<string, number>; // seconds, time-decayed
  /** Wall-clock ms of the last dwell write — used to apply decay
      between sessions so we don't have to update the whole map on
      every scroll. */
  dwellLastUpdatedAt: number;
};

/** In-memory mirror so the consumer can read synchronously after the
    first hydrate. Updated on every successful write. */
let cached: PersistedFeedSignals | null = null;

const empty = (): PersistedFeedSignals => ({
  v: VERSION,
  hiddenAuthorUids: [],
  notInterestedCatchIds: [],
  dwellByAuthorUid: {},
  dwellLastUpdatedAt: Date.now(),
});

/** Read + apply between-session decay. Dwell decays with a half-life of 7
    days — an author the user used to like but stopped reading falls back
    to neutral over a couple of weeks, instead of staying boosted forever. */
function decayDwell(s: PersistedFeedSignals): PersistedFeedSignals {
  const elapsedMs = Date.now() - s.dwellLastUpdatedAt;
  if (elapsedMs <= 0) return s;
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
  const decay = Math.pow(0.5, elapsedMs / halfLifeMs);
  if (decay >= 0.999) return s; // no-op for sub-millisecond freshness
  const next: Record<string, number> = {};
  for (const [uid, secs] of Object.entries(s.dwellByAuthorUid)) {
    const decayed = secs * decay;
    if (decayed >= 0.1) next[uid] = decayed; // drop noise floor
  }
  return { ...s, dwellByAuthorUid: next, dwellLastUpdatedAt: Date.now() };
}

export async function loadFeedSignals(): Promise<PersistedFeedSignals> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      cached = empty();
      return cached;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== VERSION) {
      cached = empty();
      return cached;
    }
    cached = decayDwell({
      v: VERSION,
      hiddenAuthorUids: Array.isArray(parsed.hiddenAuthorUids) ? parsed.hiddenAuthorUids : [],
      notInterestedCatchIds: Array.isArray(parsed.notInterestedCatchIds) ? parsed.notInterestedCatchIds : [],
      dwellByAuthorUid: typeof parsed.dwellByAuthorUid === 'object' && parsed.dwellByAuthorUid ? parsed.dwellByAuthorUid : {},
      dwellLastUpdatedAt: typeof parsed.dwellLastUpdatedAt === 'number' ? parsed.dwellLastUpdatedAt : Date.now(),
    });
    return cached;
  } catch {
    cached = empty();
    return cached;
  }
}

async function persist(next: PersistedFeedSignals): Promise<void> {
  cached = next;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best-effort — the in-memory cache is still authoritative for this session */
  }
}

export async function hideAuthor(uid: string): Promise<PersistedFeedSignals> {
  const s = await loadFeedSignals();
  if (s.hiddenAuthorUids.includes(uid)) return s;
  // Bounded LRU: drop the oldest entry past the cap so a power-user who
  // keeps hiding accounts never blows out the AsyncStorage row.
  const next: string[] = [...s.hiddenAuthorUids, uid].slice(-HIDDEN_AUTHORS_CAP);
  const updated = { ...s, hiddenAuthorUids: next };
  await persist(updated);
  return updated;
}

export async function unhideAuthor(uid: string): Promise<PersistedFeedSignals> {
  const s = await loadFeedSignals();
  const next = s.hiddenAuthorUids.filter((u) => u !== uid);
  if (next.length === s.hiddenAuthorUids.length) return s;
  const updated = { ...s, hiddenAuthorUids: next };
  await persist(updated);
  return updated;
}

export async function markNotInterested(catchId: string): Promise<PersistedFeedSignals> {
  const s = await loadFeedSignals();
  if (s.notInterestedCatchIds.includes(catchId)) return s;
  const next = [...s.notInterestedCatchIds, catchId].slice(-NOT_INTERESTED_CAP);
  const updated = { ...s, notInterestedCatchIds: next };
  await persist(updated);
  return updated;
}

/** Add `seconds` of dwell to an author's running tally, capping per-author
    at 60 seconds per session so a single ultra-long view doesn't dominate. */
export async function recordDwell(byUid: Record<string, number>): Promise<PersistedFeedSignals> {
  const s = await loadFeedSignals();
  const next: Record<string, number> = { ...s.dwellByAuthorUid };
  for (const [uid, secs] of Object.entries(byUid)) {
    if (!secs || secs < 0.2) continue; // ignore sub-200ms blips
    const prev = next[uid] ?? 0;
    next[uid] = Math.min(prev + secs, prev + 60); // session-cap the delta
  }
  // LRU prune by score so the map can't grow unbounded.
  const entries = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, DWELL_AUTHORS_CAP);
  const pruned: Record<string, number> = {};
  for (const [k, v] of entries) pruned[k] = v;
  const updated: PersistedFeedSignals = {
    ...s,
    dwellByAuthorUid: pruned,
    dwellLastUpdatedAt: Date.now(),
  };
  await persist(updated);
  return updated;
}

/** Synchronous read of the most recent in-memory snapshot. Returns null
    when the hydrate effect hasn't completed yet — callers should still
    call loadFeedSignals once on mount. */
export function readCachedSignals(): PersistedFeedSignals | null {
  return cached;
}
