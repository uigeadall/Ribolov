import { useEffect, useState } from 'react';
import { subscribeUnreadMessagesCount } from '../services/messaging';

/**
 * Live count of unread direct-message threads for the current user.
 *
 * Mirrors the `useUnreadNotifCount` hook for symmetry — the tab navigator
 * combines both into a single ProfileTab badge so users see "5" when they
 * have 3 unread notifications + 2 unread DMs without two competing badges
 * on the same icon. HomeScreen separately surfaces the breakdown via
 * `BadgeIcon` on the chat + bell icons inside its hero.
 *
 * Returns 0 while signed out so the badge stays clean during auth flips.
 */
export function useUnreadMessagesCount(uid: string | undefined): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!uid) { setCount(0); return; }
    return subscribeUnreadMessagesCount(uid, setCount);
  }, [uid]);
  return count;
}
