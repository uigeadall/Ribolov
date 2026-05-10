import {
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';

export type WaterCondition = 'crystal' | 'clear' | 'murky' | 'muddy';

export const CONDITION_LABELS: Record<WaterCondition, string> = {
  crystal: 'Кристална',
  clear: 'Бистра',
  murky: 'Мътна',
  muddy: 'Кална',
};

export type WaterReport = {
  id: string;
  waterBodyId: string;
  waterBodyKind: 'dam' | 'river';
  waterBodyName: string;
  reporterUid: string;
  reporterName: string;
  fishingActivity: number; // 1–5
  waterCondition: WaterCondition;
  note?: string;
  createdAt: string;
};

const TTL_MS = 24 * 60 * 60 * 1000;

export async function addWaterReport(
  r: Omit<WaterReport, 'id' | 'createdAt'>
): Promise<void> {
  const fb = requireFirebase();
  await addDoc(collection(fb.db, 'waterReports'), {
    ...r,
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + TTL_MS,
  });
}

export async function getWaterReports(waterBodyId: string): Promise<WaterReport[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'waterReports'),
        where('waterBodyId', '==', waterBodyId),
        orderBy('expiresAt', 'desc'),
        limit(10)
      )
    );
    const now = Date.now();
    return snap.docs
      .map((d) => {
        const data = d.data() as Omit<WaterReport, 'id'> & { expiresAt?: number; createdAt?: { toMillis?: () => number } };
        return {
          id: d.id,
          waterBodyId: data.waterBodyId,
          waterBodyKind: data.waterBodyKind,
          waterBodyName: data.waterBodyName,
          reporterUid: data.reporterUid,
          reporterName: data.reporterName,
          fishingActivity: data.fishingActivity,
          waterCondition: data.waterCondition,
          note: data.note,
          createdAt:
            typeof data.createdAt?.toMillis === 'function'
              ? new Date(data.createdAt.toMillis()).toISOString()
              : new Date().toISOString(),
          _expiresAt: data.expiresAt ?? 0,
        };
      })
      .filter((r) => (r as any)._expiresAt > now)
      .map(({ _expiresAt: _, ...r }) => r);
  } catch {
    return [];
  }
}
