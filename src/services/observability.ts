/**
 * Observability — Firebase Crashlytics adapter.
 *
 * Sentry was removed for cost reasons; Crashlytics is free forever (no
 * per-event quota, no tier ramp) and integrates with the Firebase project
 * we already pay for. The public API on this module hasn't changed —
 * existing call sites still call captureException / addBreadcrumb /
 * setObservabilityUser / initObservability the same way. Now those calls
 * actually deliver to a dashboard instead of disappearing.
 *
 * Lazy-required so the native module isn't loaded before init — keeps
 * Expo Go (no native bridge) from crashing at startup, and lets us still
 * compile-test against the typed export.
 */

let _initialized = false;

// Old instance-method shape, preserved by an adapter over RNFB's v22
// modular surface (the namespaced `crashlytics()` factory is deprecated).
type CrashlyticsAdapter = {
  setCrashlyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
  setUserId: (id: string) => Promise<void>;
  setAttribute: (key: string, value: string) => Promise<void>;
  log: (message: string) => void;
  recordError: (err: Error) => void;
};
type CrashlyticsModule = {
  getCrashlytics: () => unknown;
  setCrashlyticsCollectionEnabled: (c: unknown, enabled: boolean) => Promise<void>;
  setUserId: (c: unknown, id: string) => Promise<void>;
  setAttribute: (c: unknown, key: string, value: string) => Promise<void>;
  log: (c: unknown, message: string) => void;
  recordError: (c: unknown, err: Error) => void;
};
let _crashlytics: CrashlyticsAdapter | null = null;

function loadCrashlytics(): CrashlyticsAdapter | null {
  if (_crashlytics) return _crashlytics;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
    const instance = mod.getCrashlytics();
    _crashlytics = {
      setCrashlyticsCollectionEnabled: (enabled) => mod.setCrashlyticsCollectionEnabled(instance, enabled),
      setUserId: (id) => mod.setUserId(instance, id),
      setAttribute: (key, value) => mod.setAttribute(instance, key, value),
      log: (message) => mod.log(instance, message),
      recordError: (err) => mod.recordError(instance, err),
    };
    return _crashlytics;
  } catch {
    // Expo Go path or any environment where the native module isn't bound.
    // Silent fallthrough — dev shouldn't crash just because Crashlytics is
    // unavailable, and the no-op behaviour matches what we shipped pre-init.
    return null;
  }
}

export function initObservability(): void {
  if (_initialized) return;
  const c = loadCrashlytics();
  if (!c) return;
  // Crashlytics collection is enabled by default on a release build; the
  // explicit call here makes it idempotent + visible in code search.
  // Setting it again at runtime is a no-op for sticky collection setting.
  c.setCrashlyticsCollectionEnabled(true).catch(() => undefined);
  _initialized = true;
}

export function setObservabilityUser(
  uid: string | null,
  displayName?: string | null,
): void {
  const c = loadCrashlytics();
  if (!c) return;
  // Crashlytics' setUserId tolerates null/empty and treats it as "anonymous".
  c.setUserId(uid ?? '').catch(() => undefined);
  if (displayName) {
    c.setAttribute('displayName', displayName.slice(0, 120)).catch(() => undefined);
  }
}

/**
 * Record an exception in Crashlytics. Accepts any value — strings, plain
 * objects, real Errors. Crashlytics requires a real Error, so we coerce.
 * Context map is recorded as Crashlytics attributes (string → string) which
 * the dashboard surfaces alongside the stack trace for grouping/debugging.
 */
export function captureException(error: unknown, context?: Record<string, string>): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[captureException]', error, context);
  }
  const c = loadCrashlytics();
  if (!c) return;
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
  if (context) {
    // Attributes don't surface per-event — they're sticky session-wide on
    // Crashlytics. The intent of the per-call context map is closer to
    // "breadcrumb tag", so we also drop a log line so it's grouped with the
    // upcoming recordError call. log() is synchronous (no Promise).
    for (const [k, v] of Object.entries(context)) {
      try { c.log(`${k}=${v}`); } catch { /* ignore */ }
    }
  }
  try { c.recordError(err); } catch { /* ignore — never propagate observability failures */ }
}

/**
 * Crashlytics doesn't have a Sentry-style typed breadcrumb API; we map it
 * to .log() which writes a short human-readable line into the crash log
 * stream. The category + message format mirrors Sentry's display so the
 * mental model carries over.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const c = loadCrashlytics();
  if (!c) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  // log() is synchronous on @react-native-firebase/crashlytics; no Promise
  // to await. Wrap in try/catch so a malformed log line never bubbles up.
  try { c.log(`[${category}] ${message}${suffix}`); } catch { /* ignore */ }
}
