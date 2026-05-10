import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
