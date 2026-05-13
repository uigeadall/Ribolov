import { useEffect, useState } from 'react';
import { subscribeMyNotifications } from '../services/socialFeed';

export function useUnreadNotifCount(uid: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) { setCount(0); return; }
    return subscribeMyNotifications(uid, (items) => {
      setCount(items.filter((n) => !n.read).length);
    });
  }, [uid]);

  return count;
}
