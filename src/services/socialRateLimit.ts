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

// Periodically evict keys whose windows have fully expired to prevent unbounded
// Map growth. The eviction threshold must be AT LEAST the longest window any
// limiter uses — otherwise hour-long limiters (story/group/event/poll/livePin/
// waterReport) get their buckets wiped every 5min and the caps silently
// bypass. 1h is the current max window across all limiters in this file.
const MAX_LIMITER_WINDOW_MS = 3_600_000;
let _evictionTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of timestamps) {
    if (arr.every((t) => now - t >= MAX_LIMITER_WINDOW_MS)) timestamps.delete(key);
  }
}, 5 * 60 * 1000);

/** Clears all in-memory rate-limit state. Call on logout so the next user starts clean. */
export function resetRateLimits(): void {
  timestamps.clear();
  lastLikeAtByUid.clear();
  // Defensive — defined below but cleared here so logout always wipes state.
  if (typeof lastOpAtByKey !== 'undefined') lastOpAtByKey.clear();
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

// ─── Write-operation throttles ────────────────────────────────────────────────
// Client-side defense-in-depth against scripted spam. Server-side enforcement
// still happens via Firestore rules + (where present) Cloud Functions, but a
// determined attacker bypassing the app entirely needs the Firestore API; the
// client-side limiters protect against accidental loops and bot tooling that
// drives the actual UI. Tuned conservatively — real users don't hit these in
// normal flows, but they cap pathological cases.

/** Per-user limiter shared by `createPost`, `createDamFeedPost`, and similar
    full-content publish ops. 5/min + 800ms minimum spacing is far above any
    real user's posting rate but stops bursts. */
export function allowPostCreate(uid: string): boolean {
  if (!enforceMinSpacing(`postCreate:${uid}`, 800)) return false;
  return allowBurst(`postCreate:${uid}`, 5, 60_000);
}

/** Following someone is cheap server-side but the resulting fan-out (write
    to two subcollections + a notification) is not. Cap to 20/min. */
export function allowFollowAction(uid: string): boolean {
  return allowBurst(`follow:${uid}`, 20, 60_000);
}

/** Stories are ephemeral but each one triggers media upload + push fan-out
    to followers. 8/hour matches "you wouldn't post more than ~one every 7
    minutes if you were being normal". */
export function allowStoryPost(uid: string): boolean {
  return allowBurst(`story:${uid}`, 8, 3_600_000);
}

/** Tournament photo entry — once per tournament is the legitimate use; cap
    to 5/min to allow re-submission after an error without inviting a flood. */
export function allowTournamentEntry(uid: string): boolean {
  return allowBurst(`tournamentEntry:${uid}`, 5, 60_000);
}

/** Group / event / poll creation. These pollute discovery surfaces if abused.
    3/hour catches realistic creators (host clubs make events occasionally,
    not every minute). */
export function allowGroupCreate(uid: string): boolean {
  return allowBurst(`groupCreate:${uid}`, 3, 3_600_000);
}

export function allowEventCreate(uid: string): boolean {
  return allowBurst(`eventCreate:${uid}`, 5, 3_600_000);
}

export function allowPollCreate(uid: string): boolean {
  return allowBurst(`pollCreate:${uid}`, 5, 3_600_000);
}

/** Live "fishing here right now" pins expire after 4h. A user shouldn't be
    creating new ones constantly; 4/hour is generous. */
export function allowLivePin(uid: string): boolean {
  return allowBurst(`livePin:${uid}`, 4, 3_600_000);
}

/** Water condition reports. 6/hour is plenty for a real angler logging
    conditions through their day. */
export function allowWaterReport(uid: string): boolean {
  return allowBurst(`waterReport:${uid}`, 6, 3_600_000);
}

/** DM send. Server enforces a per-conversation cooldown via rules; this
    is a per-user global cap that catches multi-conversation flood. */
export function allowMessageSend(uid: string): boolean {
  return allowBurst(`message:${uid}`, 60, 60_000);
}

/** Saving / unsaving a post — cheap, but spammable into write-amplification
    on the saves subcollection. */
export function allowSaveToggle(uid: string): boolean {
  if (!enforceMinSpacing(`save:${uid}`, 220)) return false;
  return allowBurst(`save:${uid}`, 90, 60_000);
}

/** Catch creation — local AsyncStorage write is fast, but each catch
    triggers cloud sync (Firestore + Storage upload) which is real cost.
    A real angler in the middle of an active session might log 4-5 catches
    in 10 minutes; 30/hour is well above that and stops accidental bursts
    (double-tap pre-savingRef-guard, scripted re-runs). 1500ms minimum
    spacing makes a UI double-tap impossible to slip through even if
    savingRef somehow misses (defense in depth — JS is single-threaded so
    savingRef is the primary guard; this is the belt to its suspenders). */
export function allowCatchSave(uid: string): boolean {
  if (!enforceMinSpacing(`catchSave:${uid}`, 1500)) return false;
  return allowBurst(`catchSave:${uid}`, 30, 3_600_000);
}

/** Search calls — UI already debounces but server-side hits can spike if
    a script drives the input directly. */
export function allowSearch(uid: string): boolean {
  if (!enforceMinSpacing(`search:${uid}`, 200)) return false;
  return allowBurst(`search:${uid}`, 60, 60_000);
}

// ─── Per-key minimum-spacing helper ───────────────────────────────────────────
// Used by op-specific limiters that need both a "no two faster than X ms"
// guard AND a burst cap. Shape parallels lastLikeAtByUid above but keyed by
// the limiter's own bucket name so a single Map covers all ops.
const lastOpAtByKey = new Map<string, number>();

function enforceMinSpacing(key: string, minMs: number): boolean {
  const now = Date.now();
  const last = lastOpAtByKey.get(key) ?? 0;
  if (now - last < minMs) return false;
  lastOpAtByKey.set(key, now);
  return true;
}
