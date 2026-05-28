import { useState, useEffect, type Dispatch, type SetStateAction, type DependencyList } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

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
  /** When true, the subscription is torn down when the screen loses focus
      (user navigates to a different tab / screen) and re-opened on return.
      Use for listeners whose data is ONLY rendered on this screen — e.g.
      a notifications list, a chat detail view. Do NOT use for listeners
      that power cross-screen state like badge counts; those need to stay
      live regardless of which screen is on top. Default false. */
  pauseWhenUnfocused?: boolean;
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
  const pauseWhenUnfocused = options?.pauseWhenUnfocused ?? false;
  // Always call useIsFocused so hook order stays stable across renders even
  // when the flag toggles. The returned boolean is only consulted when
  // pauseWhenUnfocused is true; otherwise it's a no-op.
  const isFocused = useIsFocused();

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

    // Decide whether to open the subscription up front. Both gates have to
    // pass: app must be in the foreground (when pauseInBackground), AND
    // the screen must be focused (when pauseWhenUnfocused).
    const appOk = !pauseInBackground || AppState.currentState === 'active';
    const focusOk = !pauseWhenUnfocused || isFocused;
    if (appOk && focusOk) {
      open();
    }

    let appStateSub: { remove: () => void } | null = null;
    if (pauseInBackground) {
      appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (!active) return;
        // App-state changes only open the subscription when the focus gate
        // is also passing; otherwise we'd resurrect a listener for a screen
        // that's not even on top.
        const focusGateOk = !pauseWhenUnfocused || isFocused;
        if (next === 'active' && focusGateOk) open();
        else if (next === 'background' || next === 'inactive') close();
      });
    }

    return () => {
      active = false;
      appStateSub?.remove();
      close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pauseInBackground, pauseWhenUnfocused, isFocused]);

  return { data, loading, setData };
}
