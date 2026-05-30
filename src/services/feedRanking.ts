/**
 * Feed ranking (client-side v1).
 *
 * Scores each candidate FeedItem against a set of per-user signals so the
 * "За теб" tab surfaces catches the user is most likely to engage with.
 * All scoring runs locally on the items already fetched for the "Всички"
 * scope — no extra Firestore reads, no Cloud Function. Trade-off: the
 * candidate set is bounded by what the page fetched (default ~30 items),
 * so the ranking can only re-order what's there. A v2 with a server-side
 * scorer would let us widen the candidate pool.
 *
 * Signals (multiplicative):
 *   - Recency decay (half-life 24h) — base weight × 0.5^(ageHours / 24)
 *   - Followed author — × 2.0
 *   - Near a favorite spot (≤10 km) — × 1.5
 *   - Species in user's top-N most-caught — × 1.5
 *   - Engagement bonus — log10(1 + likeCount + commentCount × 2) added
 *
 * Post-sort diversity pass: drops the score multiplier of any repeat
 * author seen within the last 5 ranked items by 0.7 per repeat, then
 * re-sorts. Without this, a single power-user with 8 fresh catches
 * dominates the top of the For You feed.
 */

import type { FeedItem } from './catchSync';

export type RankingSignals = {
  followedUids: Set<string>;
  favoriteSpotCoords: Array<{ latitude: number; longitude: number }>;
  topSpeciesIds: Set<string>;
  /** Current user's uid — so we don't score their own catches in the For
      You feed (they already know about those). null when signed out. */
  myUid: string | null;
  /** Authors the user explicitly hid via the ⋯ menu. Items from these uids
      are dropped from For You entirely (not just demoted). */
  hiddenAuthorUids?: Set<string>;
  /** Specific catches the user marked "Не ме интересува". Dropped too. */
  notInterestedCatchIds?: Set<string>;
  /** Accumulated dwell-time per author (seconds, time-decayed). Used as a
      multiplicative boost: longer reading time → higher rank in future
      sessions. Capped via log() so a single power-author can't dominate. */
  dwellByAuthorUid?: Record<string, number>;
};

const RECENCY_HALF_LIFE_HOURS = 24;
const FOLLOW_BOOST = 2.0;
const FAVORITE_SPOT_BOOST = 1.5;
const TOP_SPECIES_BOOST = 1.5;
const FAVORITE_SPOT_RADIUS_KM = 10;
const DIVERSITY_DECAY = 0.7;
const DIVERSITY_WINDOW = 5;

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function ageHoursFromDateString(iso: string | undefined): number {
  if (!iso) return 9999;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 9999;
  return Math.max(0, (Date.now() - ms) / (1000 * 60 * 60));
}

function nearAnyFavorite(
  loc: { latitude?: number; longitude?: number } | undefined,
  favorites: RankingSignals['favoriteSpotCoords'],
): boolean {
  if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return false;
  if (favorites.length === 0) return false;
  for (const fav of favorites) {
    if (
      haversineKm(
        { latitude: loc.latitude, longitude: loc.longitude },
        fav,
      ) <= FAVORITE_SPOT_RADIUS_KM
    ) {
      return true;
    }
  }
  return false;
}

/** Score a single item — exposed for tests / debugging. */
export function scoreFeedItem(item: FeedItem, signals: RankingSignals): number {
  if (signals.myUid && item.ownerUid === signals.myUid) return -Infinity; // hide my own catches in For You
  // Negative-feedback drops the item entirely. The diversity pass and
  // engagement signal can't overcome an explicit "hide" — that's the
  // user telling us a hard NO.
  if (signals.hiddenAuthorUids?.has(item.ownerUid)) return -Infinity;
  if (signals.notInterestedCatchIds?.has(item.id)) return -Infinity;

  const ageHours = ageHoursFromDateString(item.date);
  let score = Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
  if (signals.followedUids.has(item.ownerUid)) score *= FOLLOW_BOOST;
  if (nearAnyFavorite(item.location, signals.favoriteSpotCoords)) score *= FAVORITE_SPOT_BOOST;
  if (signals.topSpeciesIds.has(item.speciesId)) score *= TOP_SPECIES_BOOST;

  // Dwell boost — log1p so the marginal value of each additional second
  // tapers off (the difference between 10s and 11s of reading should be
  // small; the difference between 0s and 10s should be big). Capped
  // implicitly by the log + the 60s/session cap in feedSignals.
  const dwellSecs = signals.dwellByAuthorUid?.[item.ownerUid] ?? 0;
  if (dwellSecs > 0) {
    score *= 1 + Math.log1p(dwellSecs) * 0.15;
  }

  const likes = typeof item.likeCount === 'number' ? item.likeCount : 0;
  const engagement = Math.log10(1 + likes); // capped naturally — no comment count plumbed through FeedItem
  score += engagement * 0.5; // additive so engagement boosts low-ranked items without overwhelming followed-author hits
  return score;
}

/**
 * Rank a batch of items and apply the diversity pass.
 *
 * The caller passes the items it already has on hand (no fetch in here)
 * plus the signals. Returns a NEW array — the input order is preserved
 * for the caller's other use cases.
 */
export function rankFeedItems(items: FeedItem[], signals: RankingSignals): FeedItem[] {
  type Scored = { it: FeedItem; base: number; final: number };
  const scored: Scored[] = items
    .map((it) => ({ it, base: scoreFeedItem(it, signals), final: 0 }))
    .filter((s) => Number.isFinite(s.base));

  scored.sort((a, b) => b.base - a.base);

  // Diversity pass: walk the sorted list and downweight any author that
  // already appears within the last DIVERSITY_WINDOW slots. Re-sort
  // after to let demoted items fall to their new position. This is
  // intentionally a simple two-pass approach instead of a tight loop;
  // candidate sets here are 30-60 items, so the O(n²) worst case is
  // negligible.
  const recentAuthors: string[] = [];
  for (const s of scored) {
    let demotedScore = s.base;
    let repeats = 0;
    for (const uid of recentAuthors) {
      if (uid === s.it.ownerUid) repeats += 1;
    }
    if (repeats > 0) demotedScore *= Math.pow(DIVERSITY_DECAY, repeats);
    s.final = demotedScore;
    recentAuthors.push(s.it.ownerUid);
    if (recentAuthors.length > DIVERSITY_WINDOW) recentAuthors.shift();
  }
  scored.sort((a, b) => b.final - a.final);
  return scored.map((s) => s.it);
}
