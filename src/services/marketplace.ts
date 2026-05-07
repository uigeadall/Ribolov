import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ensureFirebase } from './firebase';
import { newId } from '../storage/storage';

export type GearCondition = 'new' | 'like-new' | 'used' | 'worn';
export type GearCategory = 'rods' | 'reels' | 'lures' | 'tackle' | 'clothing' | 'other';

export const CONDITION_LABELS: Record<GearCondition, string> = {
  new: 'Ново',
  'like-new': 'Като ново',
  used: 'Използвано',
  worn: 'Износено',
};

export const CATEGORY_LABELS: Record<GearCategory, string> = {
  rods: 'Въдици',
  reels: 'Макари',
  lures: 'Примамки',
  tackle: 'Аксесоари',
  clothing: 'Облекло',
  other: 'Друго',
};

export type GearListing = {
  id: string;
  title: string;
  description: string;
  priceBGN: number;
  condition: GearCondition;
  category: GearCategory;
  photoUrl?: string;
  sellerUid: string;
  sellerName: string;
  contact: string;
  locationName: string;
  createdAt: string;
};

export async function postListing(
  l: Omit<GearListing, 'id' | 'createdAt'>
): Promise<string> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const ref = await addDoc(collection(fb.db, 'gearListings'), {
    ...l,
    title: l.title.trim().slice(0, 100),
    description: l.description.trim().slice(0, 1000),
    contact: l.contact.trim().slice(0, 100),
    createdAt: serverTimestamp(),
    active: true,
  });
  return ref.id;
}

export async function fetchListings(category?: GearCategory, maxCount = 40): Promise<GearListing[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const constraints: Parameters<typeof query>[1][] = [
    where('active', '==', true),
    orderBy('createdAt', 'desc'),
    limit(maxCount),
  ];
  if (category) constraints.splice(0, 0, where('category', '==', category));
  const snap = await getDocs(query(collection(fb.db, 'gearListings'), ...constraints));
  return snap.docs.map((d) => docToListing(d.id, d.data()));
}

export async function fetchMyListings(uid: string): Promise<GearListing[]> {
  const fb = ensureFirebase();
  if (!fb) return [];
  const snap = await getDocs(
    query(collection(fb.db, 'gearListings'), where('sellerUid', '==', uid), orderBy('createdAt', 'desc'))
  );
  return snap.docs.map((d) => docToListing(d.id, d.data()));
}

export async function getListing(id: string): Promise<GearListing | null> {
  const fb = ensureFirebase();
  if (!fb) return null;
  const snap = await getDoc(doc(fb.db, 'gearListings', id));
  if (!snap.exists()) return null;
  return docToListing(snap.id, snap.data());
}

export async function deactivateListing(id: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  await updateDoc(doc(fb.db, 'gearListings', id), { active: false });
}

function docToListing(id: string, data: Record<string, unknown>): GearListing {
  const d = data as GearListing & { createdAt?: { toMillis?: () => number } };
  return {
    id,
    title: String(d.title ?? ''),
    description: String(d.description ?? ''),
    priceBGN: Number(d.priceBGN ?? 0),
    condition: (d.condition ?? 'used') as GearCondition,
    category: (d.category ?? 'other') as GearCategory,
    photoUrl: d.photoUrl ? String(d.photoUrl) : undefined,
    sellerUid: String(d.sellerUid ?? ''),
    sellerName: String(d.sellerName ?? 'Рибар'),
    contact: String(d.contact ?? ''),
    locationName: String(d.locationName ?? ''),
    createdAt: d.createdAt?.toMillis ? new Date(d.createdAt.toMillis()).toISOString() : '',
  };
}
