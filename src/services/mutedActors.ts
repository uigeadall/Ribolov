import { doc, setDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { requireFirebase } from './firebase';

/**
 * Per-user notification mute list.
 *
 * Mirrors the existing blockedUsers / mutedConversations subcollections:
 * each user has a private `users/{uid}/mutedActors/{actorUid}` collection
 * of small marker docs. The Cloud Function `onNotificationCreated` checks
 * for the actor's marker before sending a push — present = silent (the
 * inbox doc still writes so muted users' interactions don't disappear
 * entirely; they just stop buzzing the lock screen).
 *
 * Block vs mute distinction:
 *   - block (blockedUsers): full social cutoff — blocked user can't see
 *     OR interact with you, doesn't appear in search, can't DM you
 *   - mute (mutedActors): you still see them everywhere, you just don't
 *     get push for their likes / comments / follows / etc
 *
 * Most users want mute, not block, after an annoying notification spree —
 * that's the gap this fills.
 */

export async function muteActor(myUid: string, actorUid: string, actorName?: string): Promise<void> {
  const fb = requireFirebase();
  await setDoc(doc(fb.db, 'users', myUid, 'mutedActors', actorUid), {
    mutedAt: serverTimestamp(),
    // Display name snapshot — keeps an unmute list UI readable even if the
    // user later changes their name. Optional; missing on legacy docs is OK.
    ...(actorName ? { actorName: actorName.slice(0, 120) } : {}),
  });
}

export async function unmuteActor(myUid: string, actorUid: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'users', myUid, 'mutedActors', actorUid));
}

export async function isActorMuted(myUid: string, actorUid: string): Promise<boolean> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'mutedActors', actorUid));
  return snap.exists();
}
