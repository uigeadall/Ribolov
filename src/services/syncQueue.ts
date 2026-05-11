import AsyncStorage from '@react-native-async-storage/async-storage';

/** Exponential backoff in ms, capped at maxDelayMs. */
export function calcBackoffMs(
  attempts: number,
  baseDelayMs: number,
  maxBackoffAttempts: number,
  maxDelayMs: number,
): number {
  return Math.min(baseDelayMs * 2 ** Math.min(attempts, maxBackoffAttempts), maxDelayMs);
}

/** Read and deserialize a queue from AsyncStorage; returns [] on any error. */
export async function readSyncQueue<TEntry>(
  storageKey: string,
  normalize: (raw: unknown) => TEntry[],
): Promise<TEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return [];
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Serialize and persist a queue to AsyncStorage. */
export async function writeSyncQueue<TEntry>(
  storageKey: string,
  entries: TEntry[],
): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(entries));
}
