import type { Catch } from '../types/index';

export type PersonalBest = {
  speciesId: string;
  speciesName: string;
  weightKg: number;
  lengthCm: number;
  /** Catch id of the heaviest record for this species (also the "primary"
      catchId for callers that show a single row per species — e.g.
      PersonalBestsScreen — which navigates here on tap). */
  catchId: string;
  catchDate: string;
  /** Catch id of the longest record for this species. May equal catchId
      when the same catch holds both records; differs when the heaviest
      and longest are different catches. isPersonalBestCatch checks both
      so a catch that's record-length-only still surfaces a PB badge. */
  weightCatchId: string;
  lengthCatchId: string;
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
      // Initialise both record-holder ids to this catch. They'll diverge
      // later if a different catch overtakes one dimension.
      bests.set(c.speciesId, {
        speciesId: c.speciesId,
        speciesName: c.speciesName,
        weightKg: w,
        lengthCm: l,
        catchId: c.id,
        catchDate: c.date,
        weightCatchId: c.id,
        lengthCatchId: c.id,
      });
    } else {
      const updated = { ...cur };
      if (w > cur.weightKg) {
        updated.weightKg = w;
        updated.weightCatchId = c.id;
        // `catchId` tracks the weight record for the "primary" row.
        updated.catchId = c.id;
        updated.catchDate = c.date;
      }
      if (l > cur.lengthCm) {
        updated.lengthCm = l;
        updated.lengthCatchId = c.id;
      }
      bests.set(c.speciesId, updated);
    }
  }
  return bests;
}

/** Дали уловът е личен рекорд по тегло или дължина за вида. */
export function isPersonalBestCatch(c: Catch, bests: Map<string, PersonalBest>): boolean {
  if (!c.weightKg && !c.lengthCm) return false;
  const pb = bests.get(c.speciesId);
  if (!pb) return false;
  // Match either dimension's record-holder. Previously only checked
  // `pb.catchId` which mirrored the weight-PB only — length-only PBs
  // never showed a badge in the logbook.
  return pb.weightCatchId === c.id || pb.lengthCatchId === c.id;
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
