import { collection, getDocs, limit, orderBy, query, startAfter, where, type DocumentSnapshot } from 'firebase/firestore';
import { DAMS } from '../data/dams';
import { RIVERS } from '../data/rivers';
import { requireFirebase } from './firebase';
import type { CloudCatch } from './cloudSync';

const LEADERBOARD_CACHE_TTL = 5 * 60 * 1000;
const leaderboardCache = new Map<string, { data: LeaderboardRow[]; at: number }>();

function leaderboardCacheKey(minDateIso: string, period: LeaderboardPeriod, scope: LeaderboardScope): string {
  return `${period}:${minDateIso}:${scope.type === 'water' ? `${scope.kind}:${scope.id}` : 'all'}`;
}

export type LeaderboardPeriod = 'day' | 'week' | 'month' | 'year';

export type LeaderboardScope =
  | { type: 'all' }
  | { type: 'water'; kind: 'dam' | 'river'; id: string };

export type LeaderboardRow = {
  rank: number;
  ownerUid: string;
  ownerName: string;
  totalKg: number;
  catchCount: number;
  bestKg: number;
};

/** Радиус около маркера на язовир — споделени улови с GPS в този обхват се броят за този водоем. */
export const LEADERBOARD_DAM_RADIUS_KM = 42;

/** По-широк радиус за реки (един маркер по течението). */
export const LEADERBOARD_RIVER_RADIUS_KM = 72;

export function periodMinIso(period: LeaderboardPeriod): string {
  const d = new Date();
  if (period === 'day') d.setHours(0, 0, 0, 0);
  else if (period === 'week') d.setDate(d.getDate() - 7);
  else if (period === 'month') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function scopeWaterCenter(scope: Extract<LeaderboardScope, { type: 'water' }>): {
  latitude: number;
  longitude: number;
} | null {
  if (scope.kind === 'dam') {
    const d = DAMS.find((x) => x.id === scope.id);
    return d ? { latitude: d.latitude, longitude: d.longitude } : null;
  }
  const r = RIVERS.find((x) => x.id === scope.id);
  return r ? { latitude: r.latitude, longitude: r.longitude } : null;
}

function scopeDisplayName(scope: LeaderboardScope): string | null {
  if (scope.type === 'all') return null;
  if (scope.kind === 'dam') return DAMS.find((x) => x.id === scope.id)?.name ?? null;
  return RIVERS.find((x) => x.id === scope.id)?.name ?? null;
}

/** Нормализирани поднизове за текстово съвпадение (име + част пред скоба „Дунав (Видин)“ → „дунав“, „видин“). */
export function waterNameMatchTokens(displayName: string): string[] {
  const lower = displayName.toLowerCase().trim();
  const tokens = new Set<string>();
  if (lower) tokens.add(lower);
  const inner = lower.match(/\(([^)]+)\)/);
  if (inner?.[1]) tokens.add(inner[1].trim());
  const beforeParen = lower.split('(')[0]?.trim();
  if (beforeParen) tokens.add(beforeParen);
  return [...tokens].filter((t) => t.length >= 2);
}

function textMatchesWater(locName: string, notes: string, displayName: string): boolean {
  const hay = `${locName}\n${notes}`.toLowerCase();
  return waterNameMatchTokens(displayName).some((t) => hay.includes(t));
}

/** Дали публичен улов се отнася до избрания язовир/река (GPS към маркера или текст в място/бележки). */
export function catchMatchesLeaderboardWater(c: CloudCatch, scope: LeaderboardScope): boolean {
  if (scope.type === 'all') return true;
  const center = scopeWaterCenter(scope);
  const displayName = scopeDisplayName(scope);
  if (!center || !displayName) return false;

  const lat = c.location?.latitude;
  const lon = c.location?.longitude;
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    const km = haversineKm(lat, lon, center.latitude, center.longitude);
    const maxKm = scope.kind === 'dam' ? LEADERBOARD_DAM_RADIUS_KM : LEADERBOARD_RIVER_RADIUS_KM;
    if (km <= maxKm) return true;
  }

  const locName = c.location?.name ?? '';
  const notes = c.notes ?? '';
  return textMatchesWater(locName, notes, displayName);
}

export function aggregateLeaderboard(
  catches: CloudCatch[],
  _period: LeaderboardPeriod,
  scope: LeaderboardScope
): LeaderboardRow[] {
  const filtered = catches.filter((c) => catchMatchesLeaderboardWater(c, scope));
  const byOwner = new Map<
    string,
    { name: string; totalKg: number; count: number; best: number }
  >();

  for (const c of filtered) {
    const uid = c.ownerUid;
    if (!uid) continue;
    if (c.enterLeaderboard === false) continue;
    const w = c.weightKg ?? 0;
    const prev = byOwner.get(uid);
    const name = c.ownerName ?? 'Рибар';
    if (!prev) {
      byOwner.set(uid, { name, totalKg: w, count: 1, best: w });
    } else {
      prev.totalKg += w;
      prev.count += 1;
      prev.best = Math.max(prev.best, w);
      if (name && name !== 'Рибар') prev.name = name;
    }
  }

  const rows: LeaderboardRow[] = [...byOwner.entries()]
    .map(([ownerUid, v]) => ({
      rank: 0,
      ownerUid,
      ownerName: v.name,
      totalKg: v.totalKg,
      catchCount: v.count,
      bestKg: v.best,
    }))
    .sort((a, b) => b.totalKg - a.totalKg);

  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

const PAGE_SIZE = 500;
// Hard caps per period to prevent runaway reads
const PERIOD_MAX: Record<LeaderboardPeriod, number> = {
  day: 500,
  week: 1000,
  month: 2000,
  year: 4000,
};

/**
 * Fetches public catches in pages of 500 and aggregates them incrementally.
 * Each page is released from memory before the next is fetched, avoiding
 * loading thousands of documents into a single array.
 */
export async function fetchAndAggregateLeaderboard(
  minDateIso: string,
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
): Promise<LeaderboardRow[]> {
  const cacheKey = leaderboardCacheKey(minDateIso, period, scope);
  const cached = leaderboardCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LEADERBOARD_CACHE_TTL) return cached.data;

  const fb = requireFirebase();

  const maxTotal = PERIOD_MAX[period];
  const byOwner = new Map<string, { name: string; totalKg: number; count: number; best: number }>();
  let lastDoc: DocumentSnapshot | null = null;
  let fetched = 0;

  while (fetched < maxTotal) {
    const remaining = Math.min(PAGE_SIZE, maxTotal - fetched);
    const constraints: Parameters<typeof query>[1][] = [
      where('date', '>=', minDateIso),
      orderBy('date', 'desc'),
      limit(remaining),
    ];
    if (lastDoc) constraints.push(startAfter(lastDoc));

    const snap = await getDocs(query(collection(fb.db, 'publicCatches'), ...constraints));
    if (snap.empty) break;

    for (const d of snap.docs) {
      const c = d.data() as CloudCatch;
      if (!c.ownerUid || !catchMatchesLeaderboardWater(c, scope)) continue;
      if (c.enterLeaderboard === false) continue;
      const w = c.weightKg ?? 0;
      const name = c.ownerName ?? 'Рибар';
      const prev = byOwner.get(c.ownerUid);
      if (!prev) {
        byOwner.set(c.ownerUid, { name, totalKg: w, count: 1, best: w });
      } else {
        prev.totalKg += w;
        prev.count += 1;
        prev.best = Math.max(prev.best, w);
        if (name && name !== 'Рибар') prev.name = name;
      }
    }

    fetched += snap.docs.length;
    if (snap.docs.length < remaining) break;
    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
  }

  const rows: LeaderboardRow[] = [...byOwner.entries()]
    .map(([ownerUid, v]) => ({
      rank: 0,
      ownerUid,
      ownerName: v.name,
      totalKg: v.totalKg,
      catchCount: v.count,
      bestKg: v.best,
    }))
    .sort((a, b) => b.totalKg - a.totalKg);

  rows.forEach((r, i) => { r.rank = i + 1; });
  leaderboardCache.set(cacheKey, { data: rows, at: Date.now() });
  return rows;
}
