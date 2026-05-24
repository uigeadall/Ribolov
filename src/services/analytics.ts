import { NativeModules, Platform } from 'react-native';

/**
 * Firebase Analytics wrapper.
 *
 * Lazy + try-caught probe of `@react-native-firebase/analytics`. The earlier
 * iteration wrapped only `require()` — which succeeds (Metro returns the JS
 * module) — but the actual "Native module RNFBAppModule not found" error is
 * thrown when the analytics() FACTORY is first invoked. That made the throw
 * escape this file's try/catch and surface as an Uncaught Error at the call
 * site. Calling the factory once inside loadAnalytics, while caching the
 * resolved instance (not the module), keeps the failure path entirely
 * inside the try/catch — any subsequent call returns the cached instance
 * or the cached null sentinel.
 *
 * Same safe-load pattern as appIcon.ts / StoryVideoPlayer.tsx: missing
 * native module → silent no-op, never a crash. Analytics is observability
 * — losing events during a misconfigured dev session is fine; crashing
 * the app to log one is not.
 *
 * Why @react-native-firebase/analytics, not firebase/analytics: the web
 * SDK's analytics is gtag-based and silently no-ops on React Native
 * (needs a DOM). The native module talks to the underlying iOS/Android
 * SDKs that ship with @react-native-firebase/app (already wired for App
 * Check), so no extra plugin entry in app.json is required.
 */

type AnalyticsInstance = {
  logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>;
  setUserId: (id: string | null) => Promise<void>;
  setUserProperty: (name: string, value: string | null) => Promise<void>;
  setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
};

type AnalyticsModule = {
  default: () => AnalyticsInstance;
};

// undefined = haven't probed, null = probed and unavailable, value = ready.
let cachedInstance: AnalyticsInstance | null | undefined = undefined;

function loadAnalytics(): AnalyticsInstance | null {
  if (cachedInstance !== undefined) return cachedInstance;
  // Probe for the RNFB core native module BEFORE requiring the analytics JS
  // module. When the native side isn't bundled (Expo Go, or a dev client
  // built before this dependency landed), `require('@react-native-firebase/
  // analytics')` triggers RNFB's autolinker which logs a red "Native module
  // RNFBAppModule not found" error from Objective-C / Java via the bridge.
  // That log can't be silenced from JS — even a successful try/catch around
  // the require leaves the line in the console. Short-circuiting on the
  // NativeModules probe means we never trigger the autolinker on a build
  // that lacks the binary, so no spurious log.
  if (NativeModules.RNFBAppModule == null) {
    cachedInstance = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-firebase/analytics') as AnalyticsModule;
    // Call the factory NOW so any unexpected init error happens inside this
    // try/catch instead of escaping to a downstream call site.
    cachedInstance = mod.default();
    return cachedInstance;
  } catch {
    cachedInstance = null;
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
  try {
    const a = loadAnalytics();
    if (!a) return;
    const sanitized = sanitizeParams(params);
    void a.logEvent(name, sanitized).catch(() => undefined);
  } catch {
    /* swallow — analytics must never crash the app. Outer try/catch covers
       a rare case where the cached instance becomes unusable mid-session
       (rare, but cheaper than a recurring crash). */
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
  try {
    const a = loadAnalytics();
    if (!a) return;
    void a.setUserId(uid).catch(() => undefined);
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
