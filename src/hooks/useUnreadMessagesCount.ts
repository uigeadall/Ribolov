import { useEffect, useState } from 'react';
import { subscribeUnreadMessagesCount } from '../services/messaging';

/**
 * Live count of unread direct-message threads for the current user.
 *
 * Mirrors the `useUnreadNotifCount` hook for symmetry — the tab navigator
 * combines both into a single ProfileTab badge so users see "5" when they
 * have 3 unread notifications + 2 unread DMs without two competing badges
 * on the same icon. The Profile hero separately surfaces the breakdown via
 * per-type counts.
 *
 * Returns 0 while signed out so the badge stays clean during auth flips.
 *
 * Implementation note — shared subscription. Ref-counted module-level cache
 * (mirrors useUnreadNotifCount) so concurrent consumers share one Firestore
 * listener instead of paying for one per call site. See useUnreadNotifCount
 * for the full rationale; the shape here is identical.
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
  entry.unsub = subscribeUnreadMessagesCount(uid, (n) => {
    entry.count = n;
    entry.setters.forEach((s) => s(n));
  });
  return entry;
}

export function useUnreadMessagesCount(uid: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      return;
    }
    const entry = getEntry(uid);
    entry.refCount++;
    entry.setters.add(setCount);
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
