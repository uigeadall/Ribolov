import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Catch, Spot, GearItem, TripPlan } from '../types';

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
  replaceAll: async (items: Catch[]) => {
    await writeCatches([...items]);
  },
  save: async (item: Catch) => {
    const all = await readCatches();
    const idx = all.findIndex((c) => c.id === item.id);
    // Build a new array — never mutate the cached reference in-place
    const next = idx >= 0
      ? all.map((c, i) => (i === idx ? item : c))
      : [item, ...all];
    await writeCatches(next);
    return next;
  },
  remove: async (id: string) => {
    const all = await readCatches();
    const next = all.filter((c) => c.id !== id);
    await writeCatches(next);
    return next;
  },
};

export const spotsStore = {
  list: () => readJson<Spot[]>(KEYS.spots, []),
  save: async (item: Spot) => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const idx = all.findIndex((s) => s.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.unshift(item);
    await writeJson(KEYS.spots, all);
    return all;
  },
  toggleFavorite: async (id: string) => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return all;
    const next = { ...all[idx], isFavorite: !all[idx].isFavorite };
    all[idx] = next;
    await writeJson(KEYS.spots, all);
    return all;
  },
  remove: async (id: string) => {
    const all = await readJson<Spot[]>(KEYS.spots, []);
    const next = all.filter((s) => s.id !== id);
    await writeJson(KEYS.spots, next);
    return next;
  },
};

export const gearStore = {
  list: () => readJson<GearItem[]>(KEYS.gear, []),
  save: async (item: GearItem) => {
    const all = await readJson<GearItem[]>(KEYS.gear, []);
    const idx = all.findIndex((g) => g.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.unshift(item);
    await writeJson(KEYS.gear, all);
    return all;
  },
  remove: async (id: string) => {
    const all = await readJson<GearItem[]>(KEYS.gear, []);
    const next = all.filter((g) => g.id !== id);
    await writeJson(KEYS.gear, next);
    return next;
  },
};

export const tripsStore = {
  list: () => readJson<TripPlan[]>(KEYS.trips, []),
  get: async (id: string) => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    return all.find((t) => t.id === id);
  },
  save: async (item: TripPlan) => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    const idx = all.findIndex((t) => t.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.unshift(item);
    await writeJson(KEYS.trips, all);
    return all;
  },
  remove: async (id: string) => {
    const all = await readJson<TripPlan[]>(KEYS.trips, []);
    const next = all.filter((t) => t.id !== id);
    await writeJson(KEYS.trips, next);
    return next;
  },
};

export const newId = () => Crypto.randomUUID();

export async function wipeAllLocalAppData(): Promise<void> {
  _catchesCache = null;
  await AsyncStorage.multiRemove([
    KEYS.catches,
    KEYS.spots,
    KEYS.gear,
    LEGACY_PROFILE_KEY,
    KEYS.trips,
    'ribolov:achievements:unlocked',
    'ribolov:challenges:state',
    'ribolov:notifications:morning',
    'ribolov:notifications:scheduledId',
    'ribolov:notifications:tripScheduleMap',
    'ribolov:message-sync-queue',
  ]);
}
