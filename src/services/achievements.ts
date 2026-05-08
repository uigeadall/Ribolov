import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ACHIEVEMENT_DEFS } from '../data/achievements';
import type { Achievement } from '../types';
import type { Catch } from '../types';
import { ensureFirebase } from './firebase';

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

/** Persist unlocked IDs to both AsyncStorage and Firestore (best-effort). */
async function persistUnlocked(ids: Set<string>, uid?: string): Promise<void> {
  const arr = [...ids];
  await AsyncStorage.setItem(UNLOCK_KEY, JSON.stringify(arr)).catch(() => {});
  if (!uid) return;
  const fb = ensureFirebase();
  if (!fb) return;
  setDoc(
    doc(fb.db, 'users', uid, 'achievements', 'unlocked'),
    { ids: arr },
    { merge: true }
  ).catch(() => {});
}

/** Restore unlocked IDs from Firestore into AsyncStorage on sign-in. */
export async function restoreAchievementsFromCloud(uid: string): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) return;
  try {
    const snap = await getDoc(doc(fb.db, 'users', uid, 'achievements', 'unlocked'));
    if (!snap.exists()) return;
    const remoteIds = (snap.data().ids ?? []) as string[];
    if (!Array.isArray(remoteIds) || remoteIds.length === 0) return;
    const local = await loadExtraUnlocked();
    const merged = new Set([...local, ...remoteIds]);
    await AsyncStorage.setItem(UNLOCK_KEY, JSON.stringify([...merged]));
  } catch {
    // Best-effort — local state is still valid
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
  ctx: { firebaseConfigured: boolean; userLoggedIn: boolean; uid?: string }
): Promise<Achievement[]> {
  const prevRaw = await AsyncStorage.getItem(UNLOCK_KEY);
  const prev = new Set<string>(
    prevRaw ? (JSON.parse(prevRaw) as string[])?.filter((x) => typeof x === 'string') : []
  );
  const current = await computeAchievements(catches, ctx);
  const newly = current.filter((a) => a.unlocked && !prev.has(a.id));
  if (newly.length > 0) {
    const merged = new Set([...prev, ...newly.map((n) => n.id)]);
    await persistUnlocked(merged, ctx.uid);
  }
  return newly;
}
