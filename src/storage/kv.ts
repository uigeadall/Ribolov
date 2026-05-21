/**
 * Key-value store wrapper. Currently a pass-through to AsyncStorage so the
 * app runs in Expo Go (Expo Go can't load native modules like MMKV).
 *
 * Call sites import this module instead of '@react-native-async-storage/
 * async-storage' directly so we can swap the backing implementation later
 * — e.g. to MMKV — without touching 20+ files. The plan:
 *   1. Build a dev client (`npx expo run:ios`) instead of using Expo Go.
 *   2. Add `react-native-mmkv` (pin 2.x for legacy architecture).
 *   3. Swap the body below to back getItem/setItem with MMKV's synchronous API
 *      while keeping the async signatures here.
 *
 * `migrateFromAsyncStorageIfNeeded` is a no-op today — kept exported so the
 * boot path in App.tsx doesn't need to change when we re-add MMKV.
 */

import RNAsyncStorage from '@react-native-async-storage/async-storage';

export default RNAsyncStorage;

export async function migrateFromAsyncStorageIfNeeded(): Promise<void> {
  // No-op while we're on AsyncStorage. Becomes a one-shot
  // AsyncStorage → MMKV copy when we wire MMKV back in.
}
