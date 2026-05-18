import { useState, useEffect, type Dispatch, type SetStateAction, type DependencyList } from 'react';

type SubscriptionReturn<T> = {
  data: T | null;
  loading: boolean;
  /** Allows local optimistic updates; the next subscription event will overwrite. */
  setData: Dispatch<SetStateAction<T | null>>;
};

/**
 * Manages a Firestore onSnapshot subscription lifecycle.
 * subscribe() must return its own unsubscribe function.
 * Automatically unsubscribes on unmount or when deps change.
 */
export function useFirestoreSubscription<T>(
  subscribe: (callback: (data: T) => void) => () => void,
  deps: DependencyList,
): SubscriptionReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribe((next) => {
      if (!active) return;
      setData(next);
      setLoading(false);
    });
    return () => {
      active = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, setData };
}
