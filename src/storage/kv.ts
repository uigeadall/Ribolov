import { MMKV } from 'react-native-mmkv';
import RNAsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Key-value store backed by MMKV. Exposes the AsyncStorage API surface so call
 * sites don't change beyond their import path:
 *
 *   - import AsyncStorage from '@react-native-async-storage/async-storage';
 *   + import AsyncStorage from '../storage/kv';
 *
 * Why MMKV: it's ~10× faster than AsyncStorage on hot paths (synchronous reads
 * mean catches/spots/gear/trips list operations don't bounce through a bridge
 * call per read). The wrapper keeps the async signatures for compatibility —
 * callers that `await` continue to work; internally each method resolves
 * immediately since MMKV is synchronous.
 *
 * Native module: requires a development build (Expo Go is not supported by
 * react-native-mmkv). The app already requires native modules (react-native-
 * gesture-handler, expo-image, etc.) so this is consistent with the existing
 * build story documented in CLAUDE.md.
 */

const store = new MMKV({ id: 'ribolov' });

function getItem(key: string): Promise<string | null> {
  return Promise.resolve(store.getString(key) ?? null);
}

function setItem(key: string, value: string): Promise<void> {
  store.set(key, value);
  return Promise.resolve();
}

function removeItem(key: string): Promise<void> {
  store.delete(key);
  return Promise.resolve();
}

function multiRemove(keys: string[]): Promise<void> {
  for (const k of keys) store.delete(k);
  return Promise.resolve();
}

function multiGet(keys: string[]): Promise<[string, string | null][]> {
  return Promise.resolve(keys.map((k) => [k, store.getString(k) ?? null] as [string, string | null]));
}

function getAllKeys(): Promise<string[]> {
  return Promise.resolve(store.getAllKeys());
}

function clear(): Promise<void> {
  store.clearAll();
  return Promise.resolve();
}

const AsyncStorage = {
  getItem,
  setItem,
  removeItem,
  multiRemove,
  multiGet,
  getAllKeys,
  clear,
};

export default AsyncStorage;

// ─── One-time migration ──────────────────────────────────────────────────────
// On first launch after the MMKV swap, copy every legacy AsyncStorage key into
// MMKV. We track completion with a sentinel key in MMKV itself; if it's set we
// know the migration ran and we never run again.
//
// Idempotency: even without the sentinel, copying string-to-string is safe —
// reading from MMKV would return whatever's there. But we want to clear the
// AsyncStorage copies after a successful migration so we don't have two stores
// drifting apart.
//
// We don't enumerate keys explicitly because dynamic keys exist (e.g. per-uid
// profile-photo caches, per-tournament dismiss flags). AsyncStorage's
// getAllKeys() returns the full list and we copy every entry.

const MIGRATION_SENTINEL = '__ribolov:mmkv-migrated-v1';

export async function migrateFromAsyncStorageIfNeeded(): Promise<void> {
  if (store.getString(MIGRATION_SENTINEL)) return;
  try {
    const keys = await RNAsyncStorage.getAllKeys();
    if (keys.length === 0) {
      store.set(MIGRATION_SENTINEL, String(Date.now()));
      return;
    }
    const pairs = await RNAsyncStorage.multiGet([...keys]);
    for (const [k, v] of pairs) {
      if (v != null) store.set(k, v);
    }
    // Clear AsyncStorage AFTER successful copy so a mid-migration crash leaves
    // the legacy store intact and the next launch retries.
    await RNAsyncStorage.multiRemove([...keys]).catch(() => { /* best-effort */ });
    store.set(MIGRATION_SENTINEL, String(Date.now()));
  } catch {
    // If AsyncStorage itself throws (unlikely outside test environments), don't
    // poison MMKV with the sentinel — let the next launch retry.
  }
}
