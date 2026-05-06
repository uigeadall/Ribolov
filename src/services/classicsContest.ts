import type { FeedItem } from './cloudSync';
import { fetchPublicCatchesSince } from './cloudSync';
import { fetchCatchLikeCount } from './socialFeed';

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

const BATCH = 14;

/**
 * Публични постове със снимка след подадена дата, подредени по брой лайкове.
 * Броенето е клиентско (ограничен брой постове), без Cloud Functions.
 */
export async function fetchRankedClassicPhotos(
  sinceIso: string,
  opts?: { maxCandidates?: number; resultLimit?: number }
): Promise<RankedClassicPhoto[]> {
  const maxCandidates = opts?.maxCandidates ?? 140;
  const resultLimit = opts?.resultLimit ?? 24;

  const raw = await fetchPublicCatchesSince(sinceIso, maxCandidates * 3);
  const withPhoto = raw.filter((c) => typeof c.photoUri === 'string' && c.photoUri.trim().length > 0);
  const capped = withPhoto.slice(0, maxCandidates);

  const scored: RankedClassicPhoto[] = [];
  for (let i = 0; i < capped.length; i += BATCH) {
    const chunk = capped.slice(i, i + BATCH);
    const counts = await Promise.all(chunk.map((c) => fetchCatchLikeCount(c.id)));
    for (let j = 0; j < chunk.length; j += 1) {
      scored.push({ item: chunk[j], likes: counts[j] ?? 0 });
    }
  }

  scored.sort((a, b) => {
    if (b.likes !== a.likes) return b.likes - a.likes;
    return Date.parse(b.item.date) - Date.parse(a.item.date);
  });

  return scored.slice(0, resultLimit);
}
