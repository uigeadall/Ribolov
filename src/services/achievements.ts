import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACHIEVEMENT_DEFS } from '../data/achievements';
import type { Achievement } from '../types';
import type { Catch } from '../types';

const UNLOCK_KEY = 'ribolov:achievements:unlocked';

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENT_DEFS.length;

async function loadExtraUnlocked(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(UNLOCK_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export async function computeAchievements(
  catches: Catch[],
  ctx: { firebaseConfigured: boolean; userLoggedIn: boolean }
): Promise<Achievement[]> {
  const syncedIds = new Set(catches.filter((c) => c.syncedToCloud).map((c) => c.id));
  const extra = await loadExtraUnlocked();
  const opts = { syncedIds };

  return ACHIEVEMENT_DEFS.map((def) => {
    const progress = def.progressFn(catches);
    const unlocked =
      def.unlockedFn(catches, opts) ||
      extra.has(def.id) ||
      (def.id === 'cloud_sync' && ctx.firebaseConfigured && ctx.userLoggedIn && syncedIds.size > 0);
    return {
      id: def.id,
      category: def.category,
      rarity: def.rarity,
      name: def.name,
      description: def.description,
      icon: def.icon,
      progress,
      target: def.target,
      unlocked,
    };
  });
}

export async function checkForNewUnlocks(
  catches: Catch[],
  ctx: { firebaseConfigured: boolean; userLoggedIn: boolean }
): Promise<Achievement[]> {
  const prevRaw = await AsyncStorage.getItem(UNLOCK_KEY);
  const prev = new Set<string>(
    prevRaw ? (JSON.parse(prevRaw) as string[])?.filter((x) => typeof x === 'string') : []
  );
  const current = await computeAchievements(catches, ctx);
  const newly = current.filter((a) => a.unlocked && !prev.has(a.id));
  if (newly.length > 0) {
    const merged = new Set([...prev, ...newly.map((n) => n.id)]);
    await AsyncStorage.setItem(UNLOCK_KEY, JSON.stringify([...merged]));
  }
  return newly;
}
