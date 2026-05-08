import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

const CHECK_URL = 'https://connectivitycheck.gstatic.com/generate_204';
const TIMEOUT_MS = 4_000;
const POLL_MS = 12_000;

async function ping(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(CHECK_URL, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return r.status < 400;
  } catch {
    return false;
  }
}

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  const check = useCallback(async () => {
    setOnline(await ping());
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    const id = setInterval(() => void check(), POLL_MS);
    return () => { sub.remove(); clearInterval(id); };
  }, [check]);

  return online;
}
