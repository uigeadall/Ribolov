import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

/**
 * Live "I'm fishing here right now" pin. Auto-expires after `expiresAt` (unix ms).
 * Stored at `liveFishingPins/{pinId}` for simple flat queries.
 */
export type LiveFishingPin = {
  id: string;
  ownerUid: string;
  ownerName: string;
  ownerPhotoUrl?: string;
  latitude: number;
  longitude: number;
  /** Free-form short message — e.g. "Хапе на пиявица, ела". */
  note?: string;
  /** Display name of the water if user picked one (just a label, not authoritative). */
  waterName?: string;
  /** Unix ms when this pin should disappear. */
  expiresAt: number;
};

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function createLiveFishingPin(input: {
  ownerUid: string;
  ownerName: string;
  ownerPhotoUrl?: string;
  latitude: number;
  longitude: number;
  note?: string;
  waterName?: string;
  /** Override the default 4-hour TTL. */
  ttlMs?: number;
}): Promise<string> {
  const fb = requireFirebase();
  const now = Date.now();
  const expiresAt = now + (input.ttlMs ?? DEFAULT_TTL_MS);
  const payload = stripUndefinedForFirestore({
    ownerUid: input.ownerUid,
    ownerName: input.ownerName.slice(0, 120) || 'Рибар',
    ownerPhotoUrl: input.ownerPhotoUrl,
    latitude: input.latitude,
    longitude: input.longitude,
    note: input.note?.trim().slice(0, 200) || undefined,
    waterName: input.waterName?.trim().slice(0, 120) || undefined,
    expiresAt,
    createdAt: serverTimestamp(),
  });
  const ref = await addDoc(collection(fb.db, 'liveFishingPins'), payload);
  return ref.id;
}

export async function deleteLiveFishingPin(pinId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'liveFishingPins', pinId));
}

/**
 * Returns currently-active pins (expiresAt > now). Capped at 100.
 */
export async function getActiveLivePins(): Promise<LiveFishingPin[]> {
  const fb = requireFirebase();
  const now = Date.now();
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'liveFishingPins'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(100),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LiveFishingPin, 'id'>) }));
  } catch {
    return [];
  }
}

/**
 * Realtime subscription to active pins. The snapshot listener fires whenever
 * pins are added/updated/deleted. Already-expired pins are filtered client-side
 * to keep things simple (no server-side TTL handling needed).
 */
export function subscribeActiveLivePins(cb: (pins: LiveFishingPin[]) => void): () => void {
  const fb = requireFirebase();
  const q = query(
    collection(fb.db, 'liveFishingPins'),
    orderBy('expiresAt', 'desc'),
    limit(100),
  );
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const pins = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<LiveFishingPin, 'id'>) }))
        .filter((p) => p.expiresAt > now);
      cb(pins);
    },
    () => cb([]),
  );
}

/**
 * Returns the user's currently-active pin (if any). Used to enforce
 * one-active-pin-per-user in the UI.
 */
export async function getMyActiveLivePin(uid: string): Promise<LiveFishingPin | null> {
  const fb = requireFirebase();
  const now = Date.now();
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'liveFishingPins'),
        where('ownerUid', '==', uid),
        where('expiresAt', '>', now),
        limit(1),
      ),
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...(d.data() as Omit<LiveFishingPin, 'id'>) };
  } catch {
    return null;
  }
}
