/**
 * Shared video limits for catch + story uploads. Centralising the cap here
 * keeps the picker, post-pick validator, and any future UI labels in sync
 * if the limit ever changes (e.g. bumping to 30s for premium users).
 */

export const VIDEO_MAX_SECONDS = 15;
export const VIDEO_MAX_MS = VIDEO_MAX_SECONDS * 1000;
/** Tolerance for "the picker handed us a 15.4s clip" — fractional rounding
    in expo-image-picker's trim-handle math can sneak ~0.5s over the cap.
    Anything beyond this is rejected as "the user actually picked a longer
    video and the iOS-native trimmer didn't fire." */
export const VIDEO_OVERAGE_TOLERANCE_MS = 500;

/** Returns true if a duration (ms) exceeds the cap by more than the
    rounding tolerance. asset.duration is in milliseconds when present.
    Returns false for unknown durations (0 or null) so we don't reject
    valid videos when the picker happens not to populate the field. */
export function isVideoOverLimit(durationMs: number | null | undefined): boolean {
  if (durationMs == null || durationMs <= 0) return false;
  return durationMs > VIDEO_MAX_MS + VIDEO_OVERAGE_TOLERANCE_MS;
}

/** User-facing message in Bulgarian — used by both the catch and story
    upload flows so phrasing stays consistent. */
export const VIDEO_OVER_LIMIT_MESSAGE = `Видеата са до ${VIDEO_MAX_SECONDS} секунди. Избери по-кратък клип или го изрежи в галерията.`;
