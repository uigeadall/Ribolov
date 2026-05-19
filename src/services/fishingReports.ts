import {
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  Timestamp,
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
  // No client-computed expiresAt — that field used Date.now() which could be hours/years
  // off depending on device clock. TTL is enforced by the cleanupExpiredWaterReports
  // Cloud Function and a client-side createdAt > now-TTL filter below.
  await addDoc(collection(fb.db, 'waterReports'), {
    ...r,
    createdAt: serverTimestamp(),
  });
}

export async function getWaterReports(waterBodyId: string): Promise<WaterReport[]> {
  const fb = requireFirebase();
  try {
    // Query by createdAt range — requires a (waterBodyId asc, createdAt desc) composite
    // index. Firestore will surface a one-time setup prompt in the console on first run.
    const cutoff = Timestamp.fromMillis(Date.now() - TTL_MS);
    const snap = await getDocs(
      query(
        collection(fb.db, 'waterReports'),
        where('waterBodyId', '==', waterBodyId),
        where('createdAt', '>=', cutoff),
        orderBy('createdAt', 'desc'),
        limit(10),
      )
    );
    return snap.docs.map((d) => {
      const data = d.data() as Omit<WaterReport, 'id'> & { createdAt?: { toMillis?: () => number } };
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
      };
    });
  } catch {
    return [];
  }
}
