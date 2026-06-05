/** The card the Today block should show, chosen by selectTodayCard. */
export type TodayCard =
  | { kind: 'social'; actorName: string; othersCount: number }
  | { kind: 'conditions'; rating: number; spotName: string | null }
  | { kind: 'baseline'; rating: number | null; spotName: string | null };

export type TodaySignals = {
  /** Public catches from followed anglers (most-recent first is fine). */
  followingCatches: { ownerUid: string; ownerName?: string; date: string }[];
  /** weather?.fishingRating ?? null (1..5). */
  fishingRating: number | null;
  /** nearestWaters[0]?.name ?? null. */
  nearestSpotName: string | null;
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
};

/** A 4+ rating is "drop everything and go" — matches the forecast strip's
    `best` highlight threshold (day.fishingRating >= 4). */
export const GOOD_FISHING_THRESHOLD = 4;

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Decide which Today card to show. Pure — no React, no I/O. */
export function selectTodayCard(s: TodaySignals): TodayCard {
  const now = s.now ?? new Date();

  // (1) Fresh following activity today wins — it's the most re-engaging signal.
  const todays = s.followingCatches.filter((c) => {
    const t = Date.parse(c.date);
    return !Number.isNaN(t) && isSameLocalDay(new Date(t), now);
  });
  if (todays.length > 0) {
    const owners: { uid: string; name?: string }[] = [];
    for (const c of todays) {
      if (!owners.some((o) => o.uid === c.ownerUid)) {
        owners.push({ uid: c.ownerUid, name: c.ownerName });
      }
    }
    return {
      kind: 'social',
      actorName: owners[0].name?.trim() || 'Рибар',
      othersCount: owners.length - 1,
    };
  }

  // (2) Good conditions → nudge to log a catch.
  if (s.fishingRating != null && s.fishingRating >= GOOD_FISHING_THRESHOLD) {
    return { kind: 'conditions', rating: s.fishingRating, spotName: s.nearestSpotName };
  }

  // (3) Baseline — always renders something useful.
  return { kind: 'baseline', rating: s.fishingRating, spotName: s.nearestSpotName };
}
