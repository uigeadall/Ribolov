import { doc, setDoc, deleteDoc, getDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { TtlMap } from './ttlCache';

// Block lists change rarely but are read constantly (every feed card, chat
// list, search, share sheet). 60s TTL + inflight dedup turns the
// 20-reads-per-feed-mount burst into one collection read per minute.
// block/unblock invalidate immediately so the UI never serves a stale
// "not blocked" after the user just blocked someone.
const _blockedCache = new TtlMap<string, Set<string>>(60_000);
const _inflightBlocked = new Map<string, Promise<Set<string>>>();

export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  const fb = requireFirebase();
  await setDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid), {
    blockedAt: serverTimestamp(),
  });
  _blockedCache.delete(myUid);
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid));
  _blockedCache.delete(myUid);
}

export async function isBlockedBy(myUid: string, targetUid: string): Promise<boolean> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'users', myUid, 'blockedUsers', targetUid));
  return snap.exists();
}

export async function getBlockedUids(myUid: string): Promise<Set<string>> {
  const cached = _blockedCache.get(myUid);
  if (cached) return cached;
  const inflight = _inflightBlocked.get(myUid);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const fb = requireFirebase();
      const snap = await getDocs(collection(fb.db, 'users', myUid, 'blockedUsers'));
      const set = new Set(snap.docs.map((d) => d.id));
      _blockedCache.set(myUid, set);
      return set;
    } catch {
      // Don't cache failures — the next caller should retry.
      return new Set<string>();
    } finally {
      _inflightBlocked.delete(myUid);
    }
  })();
  _inflightBlocked.set(myUid, p);
  return p;
}
