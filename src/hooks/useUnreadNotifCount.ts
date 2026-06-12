import { useEffect, useState } from 'react';
import { subscribeMyNotifications } from '../services/socialFeed';

/**
 * Live count of unread notifications for the current user.
 *
 * Implementation note — shared subscription.
 *
 * Multiple call sites use this hook concurrently (RootNavigator's tab badge
 * + the Feed top-bar icons + potentially elsewhere). The naive version of
 * this hook (one `subscribeMyNotifications` per `useEffect` mount) created
 * a distinct Firestore listener per call site, which doubled snapshot reads
 * and billing on every notifications doc update. The module-level cache
 * below ref-counts subscribers per uid: the first mount opens one listener,
 * subsequent mounts attach their setState to the same entry, and the last
 * unmount tears the listener down.
 *
 * Trade-off: a uid-stable cache means a sign-out/sign-in for the SAME user
 * within the lifetime of the JS bundle re-uses the same entry, which is
 * correct (it's the same data the listener was producing before). A
 * different-uid sign-in is keyed separately so user B never observes user
 * A's notifications — same isolation guarantee a fresh subscription gave.
 */

type CacheEntry = {
  refCount: number;
  unsub: (() => void) | null;
  count: number;
  setters: Set<(n: number) => void>;
};

const cache = new Map<string, CacheEntry>();

function getEntry(uid: string): CacheEntry {
  const existing = cache.get(uid);
  if (existing) return existing;
  const entry: CacheEntry = {
    refCount: 0,
    unsub: null,
    count: 0,
    setters: new Set(),
  };
  cache.set(uid, entry);
  entry.unsub = subscribeMyNotifications(uid, (items) => {
    const next = items.filter((n) => !n.read).length;
    entry.count = next;
    entry.setters.forEach((s) => s(next));
  });
  return entry;
}

export function useUnreadNotifCount(uid: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      return;
    }
    const entry = getEntry(uid);
    entry.refCount++;
    entry.setters.add(setCount);
    // Seed with the cached value so a late mount doesn't show 0 until the
    // next snapshot arrives.
    setCount(entry.count);
    return () => {
      entry.setters.delete(setCount);
      entry.refCount--;
      if (entry.refCount <= 0) {
        entry.unsub?.();
        cache.delete(uid);
      }
    };
  }, [uid]);

  return count;
}
