import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import type { Tournament } from '../types';

export async function createTournament(t: Tournament) {
  const fb = requireFirebase();
  const raw = { ...t, createdAt: serverTimestamp() } as Record<string, unknown>;
  await setDoc(doc(fb.db, 'tournaments', t.id), stripUndefinedForFirestore(raw), { merge: true });
}

export async function joinTournament(tournamentId: string, uid: string, displayName: string) {
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'users', uid, 'joinedTournaments', tournamentId),
    stripUndefinedForFirestore({ tournamentId, displayName, joinedAt: serverTimestamp() })
  );
  await setDoc(
    doc(fb.db, 'tournaments', tournamentId, 'participants', uid),
    stripUndefinedForFirestore({ uid, displayName, joinedAt: serverTimestamp() }),
    { merge: true }
  );
}

export type TournamentPhotoEntry = {
  id: string;
  ownerUid: string;
  ownerName: string;
  photoUri: string;
  speciesName?: string;
  catchId: string;
  likeCount: number;
  submittedAt?: unknown;
};

export async function submitCatchToTournament(
  tournamentId: string,
  entry: Omit<TournamentPhotoEntry, 'id' | 'likeCount' | 'submittedAt'>
): Promise<void> {
  const fb = requireFirebase();
  await setDoc(
    doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entry.ownerUid),
    stripUndefinedForFirestore({ ...entry, likeCount: 0, submittedAt: serverTimestamp() }),
    { merge: true }
  );
}

export async function fetchTournamentPhotoEntries(
  tournamentId: string
): Promise<TournamentPhotoEntry[]> {
  const fb = requireFirebase();
  try {
    const snap = await getDocs(
      query(
        collection(fb.db, 'tournaments', tournamentId, 'photoEntries'),
        orderBy('likeCount', 'desc'),
        limit(50)
      )
    );
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<TournamentPhotoEntry, 'id'>),
    }));
  } catch {
    return [];
  }
}

export async function toggleTournamentEntryLike(
  tournamentId: string,
  entryId: string,
  uid: string
): Promise<boolean> {
  const fb = requireFirebase();
  const likeRef = doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entryId, 'likes', uid);
  const entryRef = doc(fb.db, 'tournaments', tournamentId, 'photoEntries', entryId);
  const likeSnap = await getDoc(likeRef);
  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    updateDoc(entryRef, { likeCount: increment(-1) }).catch(() => {});
    return false;
  }
  await setDoc(likeRef, { uid, likedAt: serverTimestamp() });
  updateDoc(entryRef, { likeCount: increment(1) }).catch(() => {});
  return true;
}

export async function getMyLikedEntries(
  tournamentId: string,
  uid: string,
  entryIds: string[]
): Promise<Set<string>> {
  const fb = requireFirebase();
  const results = await Promise.all(
    entryIds.map((id) =>
      getDoc(doc(fb.db, 'tournaments', tournamentId, 'photoEntries', id, 'likes', uid))
    )
  );
  const liked = new Set<string>();
  results.forEach((snap, i) => { if (snap.exists()) liked.add(entryIds[i]); });
  return liked;
}
