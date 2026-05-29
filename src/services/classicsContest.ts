import { doc, getDoc } from 'firebase/firestore';
import type { FeedItem } from './cloudSync';
import { fetchPublicCatchesSince } from './cloudSync';
import { requireFirebase } from './firebase';

export type ClassicPeriod = 'week' | 'month';

/** Начало на ISO седмицата (понеделник 00:00, локална часова зона). */
export function startOfIsoWeekLocal(now = new Date()): string {
  const x = new Date(now);
  const day = x.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + mondayOffset);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

export function startOfIsoMonthLocal(now = new Date()): string {
  const x = new Date(now.getFullYear(), now.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

export function periodStartIso(period: ClassicPeriod, now = new Date()): string {
  return period === 'week' ? startOfIsoWeekLocal(now) : startOfIsoMonthLocal(now);
}

export type RankedClassicPhoto = { item: FeedItem; likes: number };

/**
 * Server-maintained cache doc shape produced by the
 * `consolidateClassicsCache` Cloud Function (runs hourly). Each entry is
 * the subset of FeedItem fields the leaderboard UI needs — the cache
 * intentionally doesn't store every catch field, so a cache hit may lack
 * some properties (e.g. coordinates, notes) the full FeedItem normally
 * has. Consumers that depend on those should refetch the individual doc.
 */
type ClassicsCacheItem = {
  id: string;
  ownerUid: string;
  ownerName: string;
  photoUri: string;
  photoTitle: string | null;
  likeCount: number;
  date: string;
  speciesName: string;
  weightKg: number | null;
};
type ClassicsCacheDoc = {
  items: ClassicsCacheItem[];
  sinceIso: string;
  updatedAt: { toMillis?: () => number } | undefined;
};

/** Cache TTL for the server-maintained ranking. Beyond this the client
 *  falls back to the legacy scan path — protects against a stuck cron
 *  silently serving stale data forever. The hourly cron means the cache
 *  is normally well under 1h old; 3h gives plenty of slack. */
const CLASSICS_CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * Best-effort detector for which period a caller is asking about. We can't
 * tell from `sinceIso` alone (it's a timestamp) — so we compare against the
 * current week-start and month-start. Drift of a few minutes is fine; the
 * cache doc covers the whole period, not a specific timestamp.
 */
function inferPeriodFromSinceIso(sinceIso: string): ClassicPeriod | null {
  const now = new Date();
  const weekStart = startOfIsoWeekLocal(now);
  const monthStart = startOfIsoMonthLocal(now);
  // Same calendar minute is enough for a match — accounts for re-renders
  // computing `new Date()` ~milliseconds apart.
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(sinceMs)) return null;
  const within = (other: string) => Math.abs(sinceMs - Date.parse(other)) < 60_000;
  if (within(weekStart)) return 'week';
  if (within(monthStart)) return 'month';
  return null;
}

/**
 * Публични постове със снимка след подадена дата, подредени по брой лайкове.
 *
 * Read path:
 *   1. Try `classicsCache/{period}` — a server-maintained pre-ranked list
 *      updated hourly by `consolidateClassicsCache`. One Firestore read.
 *   2. If cache is missing, stale, or the caller's `sinceIso` doesn't
 *      correspond to the current week/month, fall back to the legacy
 *      `fetchPublicCatchesSince`+client-aggregation path (60–420 reads
 *      depending on opts).
 *
 * The previous client-side aggregation was the third-largest line item
 * after the leaderboard scan and per-DAU Firestore listeners — replacing
 * the common-case fetch saves ~$75–150/mo at 10k DAU.
 */
export async function fetchRankedClassicPhotos(
  sinceIso: string,
  opts?: { maxCandidates?: number; resultLimit?: number }
): Promise<RankedClassicPhoto[]> {
  const maxCandidates = opts?.maxCandidates ?? 140;
  const resultLimit = opts?.resultLimit ?? 24;

  // Try the cache first when the sinceIso lines up with a known period.
  const period = inferPeriodFromSinceIso(sinceIso);
  if (period) {
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'classicsCache', period));
      if (snap.exists()) {
        const cached = snap.data() as ClassicsCacheDoc;
        const updatedAtMs =
          typeof cached.updatedAt?.toMillis === 'function'
            ? cached.updatedAt.toMillis()
            : 0;
        if (updatedAtMs > 0 && Date.now() - updatedAtMs < CLASSICS_CACHE_MAX_AGE_MS) {
          // Map cache items into the RankedClassicPhoto shape the
          // consumers expect. `item` is typed as FeedItem (= CloudCatch);
          // we widen to that type knowing consumers only touch the subset
          // of fields the cache actually contains.
          const ranked: RankedClassicPhoto[] = cached.items
            .slice(0, resultLimit)
            .map((it) => ({
              item: it as unknown as FeedItem,
              likes: it.likeCount ?? 0,
            }));
          return ranked;
        }
      }
    } catch {
      // Cache read failed — fall through to the legacy aggregation path.
    }
  }

  // Fallback: legacy client-side aggregation. Used when the cache is empty
  // (just-deployed projects, brand-new period that hasn't been consolidated
  // yet), stale (>3h), or the caller's sinceIso doesn't correspond to a
  // current period boundary.
  const raw = await fetchPublicCatchesSince(sinceIso, maxCandidates * 3);
  const withPhoto = raw.filter(
    (c) => typeof c.photoUri === 'string' && c.photoUri.trim().length > 0
  );
  const scored: RankedClassicPhoto[] = withPhoto
    .slice(0, maxCandidates)
    .map((c) => ({ item: c, likes: c.likeCount ?? 0 }));

  scored.sort((a, b) => {
    if (b.likes !== a.likes) return b.likes - a.likes;
    return Date.parse(b.item.date) - Date.parse(a.item.date);
  });

  return scored.slice(0, resultLimit);
}
