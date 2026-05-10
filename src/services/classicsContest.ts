import type { FeedItem } from './cloudSync';
import { fetchPublicCatchesSince } from './cloudSync';

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
 * Публични постове със снимка след подадена дата, подредени по брой лайкове.
 * Uses denormalized likeCount field on each publicCatches document — no extra reads.
 */
export async function fetchRankedClassicPhotos(
  sinceIso: string,
  opts?: { maxCandidates?: number; resultLimit?: number }
): Promise<RankedClassicPhoto[]> {
  const maxCandidates = opts?.maxCandidates ?? 140;
  const resultLimit = opts?.resultLimit ?? 24;

  const raw = await fetchPublicCatchesSince(sinceIso, maxCandidates * 3);
  // Only in-app camera photos are eligible — gallery imports are excluded.
  const withPhoto = raw.filter(
    (c) => c.photoTakenWithAppCamera === true &&
           typeof c.photoUri === 'string' && c.photoUri.trim().length > 0
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
