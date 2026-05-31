import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { requireFirebase } from './firebase';

/**
 * Referral stats — how many users have signed up via my invite link.
 *
 * Implementation: a single getCountFromServer query against the `users`
 * collection filtered by `invitedBy == myUid`. The aggregation query
 * costs 1 Firestore read regardless of how many users match, so this
 * is safe to call on every ProfileScreen mount without breaking cost
 * targets.
 *
 * Privacy note: only the COUNT is surfaced, not the list of invited
 * users — knowing your friend joined via your link is fine, but
 * exposing the full referral graph would be a privacy regression for
 * the invitees who never agreed to be publicly identified as "invited
 * by X".
 */
export async function countMyInvites(myUid: string): Promise<number> {
  if (!myUid) return 0;
  try {
    const fb = requireFirebase();
    const agg = await getCountFromServer(
      query(collection(fb.db, 'users'), where('invitedBy', '==', myUid)),
    );
    return agg.data().count;
  } catch {
    return 0;
  }
}
