import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  addDoc,
  updateDoc,
} from 'firebase/firestore';
import { ensureFirebase } from './firebase';

export type GuideProfile = {
  uid: string;
  displayName: string;
  bio?: string;
  photoUrl?: string;
  specialty: string;          // e.g. "Шаран и бяла риба"
  waters: string[];           // list of dam/river IDs this guide operates on
  contactPhone?: string;
  contactEmail?: string;
  priceRange?: string;        // e.g. "50–100 лв./ден"
  verified: boolean;
  verifiedAt?: string;
};

export async function submitGuideRequest(
  uid: string,
  data: {
    displayName: string;
    specialty: string;
    waters: string[];
    contactPhone?: string;
    contactEmail?: string;
    priceRange?: string;
    note?: string;
  }
): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  await setDoc(doc(fb.db, 'guideRequests', uid), {
    ...data,
    uid,
    status: 'pending',
    submittedAt: serverTimestamp(),
  });
}

export async function getGuideProfile(uid: string): Promise<GuideProfile | null> {
  const fb = ensureFirebase();
  if (!fb) return null;
  try {
    const snap = await getDoc(doc(fb.db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    if (!d.isGuide) return null;
    return {
      uid,
      displayName: String(d.displayName ?? 'Рибар'),
      bio: d.bio ? String(d.bio) : undefined,
      photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
      specialty: String(d.guideSpecialty ?? ''),
      waters: Array.isArray(d.guideWaters) ? (d.guideWaters as string[]) : [],
      contactPhone: d.guidePhone ? String(d.guidePhone) : undefined,
      contactEmail: d.guideEmail ? String(d.guideEmail) : undefined,
      priceRange: d.guidePriceRange ? String(d.guidePriceRange) : undefined,
      verified: Boolean(d.verified),
      verifiedAt: d.verifiedAt ? String(d.verifiedAt) : undefined,
    };
  } catch {
    return null;
  }
}

/** Намира верифицирани водачи за даден водоем. */
export async function getGuidesForWater(waterBodyId: string): Promise<GuideProfile[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'users'),
        where('isGuide', '==', true),
        where('guideWaters', 'array-contains', waterBodyId)
      )
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          uid: d.id,
          displayName: String(data.displayName ?? 'Рибар'),
          bio: data.bio ? String(data.bio) : undefined,
          photoUrl: data.photoUrl ? String(data.photoUrl) : undefined,
          specialty: String(data.guideSpecialty ?? ''),
          waters: Array.isArray(data.guideWaters) ? (data.guideWaters as string[]) : [],
          contactPhone: data.guidePhone ? String(data.guidePhone) : undefined,
          priceRange: data.guidePriceRange ? String(data.guidePriceRange) : undefined,
          verified: Boolean(data.verified),
        };
      })
      .filter((g) => g.specialty);
  } catch {
    return [];
  }
}
