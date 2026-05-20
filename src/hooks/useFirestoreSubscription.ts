import { useState, useEffect, type Dispatch, type SetStateAction, type DependencyList } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type SubscriptionReturn<T> = {
  data: T | null;
  loading: boolean;
  /** Allows local optimistic updates; the next subscription event will overwrite. */
  setData: Dispatch<SetStateAction<T | null>>;
};

type SubscriptionOptions = {
  /** When true, the subscription is torn down when the app is backgrounded
      and re-established on next foreground. Use for high-traffic listeners
      (inbox, notifications) where reads + battery cost while the app sits
      in the background isn't worth it. Default false — most subscriptions
      should keep running so we don't miss updates between sessions. */
  pauseInBackground?: boolean;
};

/**
 * Manages a Firestore onSnapshot subscription lifecycle.
 * subscribe() must return its own unsubscribe function.
 * Automatically unsubscribes on unmount or when deps change.
 */
export function useFirestoreSubscription<T>(
  subscribe: (callback: (data: T) => void) => () => void,
  deps: DependencyList,
  options?: SubscriptionOptions,
): SubscriptionReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const pauseInBackground = options?.pauseInBackground ?? false;

  useEffect(() => {
    let active = true;
    let unsub: (() => void) | null = null;

    const open = () => {
      if (unsub) return; // already open
      setLoading(true);
      unsub = subscribe((next) => {
        if (!active) return;
        setData(next);
        setLoading(false);
      });
    };

    const close = () => {
      if (!unsub) return;
      unsub();
      unsub = null;
    };

    // Initial open — but only if the app is currently active when the flag
    // is set. On a cold start AppState is always 'active'; this matters for
    // the case where a deps change happens while backgrounded (rare).
    if (!pauseInBackground || AppState.currentState === 'active') {
      open();
    }

    let appStateSub: { remove: () => void } | null = null;
    if (pauseInBackground) {
      appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (!active) return;
        if (next === 'active') open();
        else if (next === 'background' || next === 'inactive') close();
      });
    }

    return () => {
      active = false;
      appStateSub?.remove();
      close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pauseInBackground]);

  return { data, loading, setData };
}
