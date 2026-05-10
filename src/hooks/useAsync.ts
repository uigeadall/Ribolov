import { useState, useCallback, useEffect, useRef, type DependencyList } from 'react';

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

type UseAsyncReturn<T> = AsyncState<T> & {
  reload: (silent?: boolean) => void;
};

/**
 * Runs an async function and tracks its loading/error/data state.
 * Re-runs whenever deps change. Call reload() to manually re-fetch.
 * Call reload(true) for pull-to-refresh: keeps existing data, sets refreshing:true.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: DependencyList,
): UseAsyncReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    refreshing: false,
    error: null,
  });

  const runIdRef = useRef(0);

  const run = useCallback(async (silent = false) => {
    const id = ++runIdRef.current;
    setState((prev) => ({
      ...prev,
      data: silent ? prev.data : null,
      loading: !silent,
      refreshing: silent,
      error: null,
    }));
    try {
      const data = await fn();
      if (runIdRef.current === id) setState({ data, loading: false, refreshing: false, error: null });
    } catch (e: unknown) {
      if (runIdRef.current === id) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((prev) => ({ ...prev, loading: false, refreshing: false, error: msg }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run(false);
  }, [run]);

  return { ...state, reload: run };
}
