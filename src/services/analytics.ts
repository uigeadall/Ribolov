import { Platform } from 'react-native';

/**
 * Firebase Analytics wrapper.
 *
 * Lazy + try-caught `require` of `@react-native-firebase/analytics` so the
 * app still boots when the native module isn't bundled — same pattern as
 * appIcon.ts / StoryVideoPlayer.tsx. Plain top-level import would crash
 * Expo Go and any dev client built before this dependency landed.
 *
 * Why we're on @react-native-firebase/analytics, not firebase/analytics:
 * the web SDK's analytics module is gtag-based and silently no-ops on
 * React Native because it needs a DOM. The native module talks to the
 * underlying iOS/Android SDKs that ship with @react-native-firebase/app
 * (which we already use for App Check), so no extra plugin entry is
 * required in app.json.
 *
 * All exports are best-effort: if the native module isn't loaded, calls
 * silently no-op. Analytics is observability — losing a few events during
 * a misconfigured dev session is fine; crashing the app to log an event
 * is not.
 *
 * Standard event names follow Firebase / GA4 conventions where applicable
 * (e.g. snake_case with leading verb). Custom params are flattened — GA4
 * supports up to 25 params per event but only the first ~10 are
 * meaningfully aggregatable in the dashboard.
 */

type AnalyticsModule = {
  default: () => {
    logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>;
    setUserId: (id: string | null) => Promise<void>;
    setUserProperty: (name: string, value: string | null) => Promise<void>;
    setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
  };
};

let cachedMod: AnalyticsModule | null | undefined = undefined;
function loadAnalytics(): AnalyticsModule['default'] | null {
  if (cachedMod === null) return null;
  if (cachedMod !== undefined) return cachedMod.default;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMod = require('@react-native-firebase/analytics') as AnalyticsModule;
    return cachedMod.default;
  } catch {
    cachedMod = null;
    return null;
  }
}

/**
 * Log a custom analytics event. Drop in at user-action moments
 * (catch_logged, post_shared, etc) — auto-events like screen_view +
 * app_open + first_open are recorded by the SDK without our help.
 *
 * Param values are coerced to GA4-compatible primitives. Strings are
 * truncated to 100 chars (GA4 limit); numbers and booleans pass through.
 * Anything else is dropped silently to avoid serialisation errors.
 */
export function logEvent(name: string, params?: Record<string, unknown>): void {
  const get = loadAnalytics();
  if (!get) return;
  try {
    const sanitized = sanitizeParams(params);
    void get().logEvent(name, sanitized).catch(() => undefined);
  } catch {
    /* swallow — analytics must never crash the app */
  }
}

/**
 * Attribute subsequent events to a signed-in user. Pass null on sign-out
 * to detach (anonymous events still log). Mirrors the
 * setObservabilityUser pattern in observability.ts so call sites stay
 * symmetric across both telemetry surfaces.
 *
 * Firebase Analytics enforces a 256-char limit on user IDs; Firebase uids
 * are well under that.
 */
export function setAnalyticsUser(uid: string | null): void {
  const get = loadAnalytics();
  if (!get) return;
  try {
    void get().setUserId(uid).catch(() => undefined);
  } catch {
    /* swallow */
  }
}

function sanitizeParams(
  params: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      out[k] = v.slice(0, 100);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
    // Anything else (objects, arrays) silently dropped — GA4 rejects them
    // and we'd rather lose one field than the whole event.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Platform is exported so call sites can include it as a param when useful
// (e.g. catch_logged events split by iOS vs Android in the dashboard).
export const ANALYTICS_PLATFORM = Platform.OS;
