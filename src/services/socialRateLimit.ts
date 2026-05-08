/**
 * Клиентски ограничители срещу спам (лайкове/коментари).
 * Не замества сървърни лимити — само намалява случайното или скриптово натискане от един клиент.
 */

type BucketKey = string;

const timestamps = new Map<BucketKey, number[]>();

function prune(now: number, arr: number[], windowMs: number): number[] {
  return arr.filter((t) => now - t < windowMs);
}

/** Връща false при превишен лимит. */
export function allowBurst(key: BucketKey, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = prune(now, timestamps.get(key) ?? [], windowMs);
  if (arr.length >= maxPerWindow) {
    timestamps.set(key, arr);
    return false;
  }
  arr.push(now);
  timestamps.set(key, arr);
  return true;
}

const lastLikeAtByUid = new Map<string, number>();

export function allowLikeToggle(uid: string): boolean {
  const now = Date.now();
  const last = lastLikeAtByUid.get(uid) ?? 0;
  if (now - last < 220) return false;
  lastLikeAtByUid.set(uid, now);
  return allowBurst(`like:${uid}`, 90, 60_000);
}

export function allowComment(uid: string): boolean {
  return allowBurst(`comment:${uid}`, 30, 60_000);
}
