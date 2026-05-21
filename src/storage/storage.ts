import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Catch, Spot, GearItem, TripPlan } from '../types';
import { resetRateLimits } from '../services/socialRateLimit';

const KEYS = {
  catches: '@ribolov/catches',
  spots: '@ribolov/spots',
  gear: '@ribolov/gear',
  trips: '@ribolov/trips',
} as const;

/** Legacy ключ — само за изчистване при wipe */
const LEGACY_PROFILE_KEY = '@ribolov/profile';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

let _catchesCache: Catch[] | null = null;

// Serialise all read-modify-write operations to prevent concurrent saves from clobbering each other.
function makeMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return function withMutex<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.then(() => {}, () => {});
    return next as Promise<T>;
  };
}

const withCatchesMutex = makeMutex();
const withSpotsMutex = makeMutex();
const withGearMutex = makeMutex();
const withTripsMutex = makeMutex();

async function readCatches(): Promise<Catch[]> {
  if (_catchesCache !== null) return _catchesCache;
  const list = await readJson<Catch[]>(KEYS.catches, []);
  _catchesCache = list;
  return list;
}

async function writeCatches(items: Catch[]): Promise<void> {
  // Always store a new array reference so React detects the change via reference equality
  _catchesCache = items;
  await writeJson(KEYS.catches, items);
}

export const catchesStore = {
  // Return a shallow copy so every call gives a new reference — React useMemo will
  // always see a changed dependency and recompute filtered lists after a save.
  list: () => readCatches().then((c) => [...c]),
  replaceAll: (items: Catch[]) => withCatchesMutex(async () => {
    await writeCatches([...items]);
  }),
  save: (item: Catch) => withCatchesMutex(async () => {
    const all = await readCatches();
    const idx = all.findIndex((c) => c.id === item.id);
    // Build a new array — never mutate the cached reference in-place
    const next = idx >= 0
      ? all.map((c, i) => (i === idx ? item : c))
      : [item, ...all];
    await writeCatches(next);
    return next;
  }),
  remove: (id: string) => withCatchesMutex(async () => {
    const all = await readCatches();
    const next = all.filter((c) => c.id !== id);
    await writeCatches(next);
    return next;
  }),
};

export const spotsStore = {
  list: () => readJson<Spot[]>(KEYS.spots, []),
  save: (item: Spot) => withSpotsMutex(async () => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const idx = all.findIndex((s) => s.id === item.id);
    const next = idx >= 0 ? all.map((s, i) => (i === idx ? item : s)) : [item, ...all];
    await writeJson(KEYS.spots, next);
    return next;
  }),
  toggleFavorite: (id: string) => withSpotsMutex(async () => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return all;
    const next = all.map((s, i) => i === idx ? { ...s, isFavorite: !s.isFavorite } : s);
    await writeJson(KEYS.spots, next);
    return next;
  }),
  remove: (id: string) => withSpotsMutex(async () => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const next = all.filter((s) => s.id !== id);
    await writeJson(KEYS.spots, next);
    return next;
  }),
};

export const gearStore = {
  list: () => readJson<GearItem[]>(KEYS.gear, []),
  save: (item: GearItem) => withGearMutex(async () => {
    const all = await readJson<GearItem[]>(KEYS.gear, []);
    const idx = all.findIndex((g) => g.id === item.id);
    const next = idx >= 0 ? all.map((g, i) => (i === idx ? item : g)) : [item, ...all];
    await writeJson(KEYS.gear, next);
    return next;
  }),
  remove: (id: string) => withGearMutex(async () => {
    const all = await readJson<GearItem[]>(KEYS.gear, []);
    const next = all.filter((g) => g.id !== id);
    await writeJson(KEYS.gear, next);
    return next;
  }),
};

export const tripsStore = {
  list: () => readJson<TripPlan[]>(KEYS.trips, []),
  get: async (id: string) => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    return all.find((t) => t.id === id);
  },
  save: (item: TripPlan) => withTripsMutex(async () => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    const idx = all.findIndex((t) => t.id === item.id);
    const next = idx >= 0 ? all.map((t, i) => (i === idx ? item : t)) : [item, ...all];
    await writeJson(KEYS.trips, next);
    return next;
  }),
  remove: (id: string) => withTripsMutex(async () => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    const next = all.filter((t) => t.id !== id);
    await writeJson(KEYS.trips, next);
    return next;
  }),
};

/** Build a `Map<spotName, catchCount>` from a list of catches. Used to
    surface "you've fished here N times" on spot rows in MapScreen and the
    TripPlanner picker. Matches by exact `location.name` — catches without a
    spot name don't contribute. */
export function getCatchCountByName(catches: Catch[]): Map<string, number> {
  const m = new Map<string, number>();
  catches.forEach((c) => {
    if (c.location?.name) m.set(c.location.name, (m.get(c.location.name) ?? 0) + 1);
  });
  return m;
}

export const newId = () => Crypto.randomUUID();

const RECENT_BAITS_KEY = '@ribolov/recent-baits';
const RECENT_SPECIES_KEY = '@ribolov/recent-species';

export const recentBaitsStore = {
  get: (): Promise<string[]> => readJson<string[]>(RECENT_BAITS_KEY, []),
  push: async (bait: string): Promise<void> => {
    const trimmed = bait.trim();
    if (!trimmed) return;
    const all = await readJson<string[]>(RECENT_BAITS_KEY, []);
    const next = [trimmed, ...all.filter((b) => b !== trimmed)].slice(0, 5);
    await writeJson(RECENT_BAITS_KEY, next);
  },
};

export const recentSpeciesStore = {
  get: (): Promise<string[]> => readJson<string[]>(RECENT_SPECIES_KEY, []),
  push: async (speciesId: string): Promise<void> => {
    if (!speciesId) return;
    const all = await readJson<string[]>(RECENT_SPECIES_KEY, []);
    const next = [speciesId, ...all.filter((id) => id !== speciesId)].slice(0, 3);
    await writeJson(RECENT_SPECIES_KEY, next);
  },
};

export async function wipeAllLocalAppData(): Promise<void> {
  _catchesCache = null;
  resetRateLimits();
  await AsyncStorage.multiRemove([
    KEYS.catches,
    KEYS.spots,
    KEYS.gear,
    LEGACY_PROFILE_KEY,
    KEYS.trips,
    RECENT_BAITS_KEY,
    RECENT_SPECIES_KEY,
    'ribolov:achievements:unlocked',
    'ribolov:challenges:state',
    'ribolov:notifications:morning',
    'ribolov:notifications:scheduledId',
    'ribolov:notifications:tripScheduleMap',
    'ribolov:catch-sync-queue',
    'ribolov:message-sync-queue',
  ]);
}
