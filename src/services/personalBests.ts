import type { Catch } from '../types/index';

export type PersonalBest = {
  speciesId: string;
  speciesName: string;
  weightKg: number;
  lengthCm: number;
  catchId: string;
  catchDate: string;
};

/** Изчислява личните рекорди по вид от списъка с улови. */
export function computePersonalBests(catches: Catch[]): Map<string, PersonalBest> {
  const bests = new Map<string, PersonalBest>();
  for (const c of catches) {
    const w = c.weightKg ?? 0;
    const l = c.lengthCm ?? 0;
    if (w === 0 && l === 0) continue;
    const cur = bests.get(c.speciesId);
    if (!cur) {
      bests.set(c.speciesId, { speciesId: c.speciesId, speciesName: c.speciesName, weightKg: w, lengthCm: l, catchId: c.id, catchDate: c.date });
    } else {
      const updated = { ...cur };
      if (w > cur.weightKg) { updated.weightKg = w; updated.catchId = c.id; updated.catchDate = c.date; }
      if (l > cur.lengthCm) updated.lengthCm = l;
      bests.set(c.speciesId, updated);
    }
  }
  return bests;
}

/** Дали уловът е личен рекорд по тегло или дължина за вида. */
export function isPersonalBestCatch(c: Catch, bests: Map<string, PersonalBest>): boolean {
  if (!c.weightKg && !c.lengthCm) return false;
  return bests.get(c.speciesId)?.catchId === c.id;
}

/** Дали новият улов надминава предишен рекорд. */
export function checkNewPersonalBest(
  newCatch: Catch,
  allCatches: Catch[]
): { isNew: boolean; field: 'weight' | 'length' | 'both' | null } {
  const prev = allCatches.filter((c) => c.id !== newCatch.id && c.speciesId === newCatch.speciesId);
  const bestW = Math.max(0, ...prev.map((c) => c.weightKg ?? 0));
  const bestL = Math.max(0, ...prev.map((c) => c.lengthCm ?? 0));
  const wPB = (newCatch.weightKg ?? 0) > 0 && (newCatch.weightKg ?? 0) > bestW;
  const lPB = (newCatch.lengthCm ?? 0) > 0 && (newCatch.lengthCm ?? 0) > bestL;
  if (!wPB && !lPB) return { isNew: false, field: null };
  return { isNew: true, field: wPB && lPB ? 'both' : wPB ? 'weight' : 'length' };
}
