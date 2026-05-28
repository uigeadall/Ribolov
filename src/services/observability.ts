/**
 * Observability — Sentry-backed error reporting.
 *
 * Sentry was previously removed for cost reasons; the free tier (5,000
 * errors/month + 10,000 perf units/month) is generous enough for an early-
 * stage app, so it's back. Once the app has real users, the marginal value
 * of "a real user crashed at 03:14 and we can see the stack" is huge —
 * shipping without it is flying blind.
 *
 * The whole module is gated on `EXPO_PUBLIC_SENTRY_DSN` (or `sentryDsn` in
 * app.json's `extra`). Without a DSN it short-circuits to the previous
 * no-op behavior so dev builds + first-launch-after-clone don't spam a
 * fake project.
 */

import * as Sentry from '@sentry/react-native';

function readDsn(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as typeof import('expo-constants').default;
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    const fromExtra = typeof extra.sentryDsn === 'string' ? extra.sentryDsn.trim() : '';
    if (fromExtra) return fromExtra;
  } catch {
    /* expo-constants not available in some test contexts */
  }
  return (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
}

let _initialized = false;

export function initObservability(): void {
  if (_initialized) return;
  const dsn = readDsn();
  if (!dsn) {
    // No DSN configured — stay in no-op mode. Dev builds before the DSN
    // is set hit this path and we don't want noisy "Sentry not initialized"
    // warnings on every cold start.
    return;
  }
  Sentry.init({
    dsn,
    // Capture unhandled JS errors, native crashes, and React component-tree
    // errors via the ErrorBoundary in App.tsx (Sentry hooks into componentDidCatch).
    enableAutoSessionTracking: true,
    // Performance monitoring is metered separately on the free tier — sample
    // at 10% so we don't burn the budget on hot screens like the feed.
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
    // Don't send in dev — local errors clutter the prod project and waste
    // the free-tier event budget. Override with `EXPO_PUBLIC_SENTRY_FORCE`
    // if you actually want to test the integration locally.
    enabled: !__DEV__ || (process.env.EXPO_PUBLIC_SENTRY_FORCE ?? '') === '1',
  });
  _initialized = true;
}

export function setObservabilityUser(
  uid: string | null,
  displayName?: string | null,
): void {
  if (!_initialized) return;
  if (uid) {
    Sentry.setUser({ id: uid, username: displayName ?? undefined });
  } else {
    // Clear identity on sign-out so the next account's errors aren't tagged
    // with the previous user.
    Sentry.setUser(null);
  }
}

export function captureException(
  error: unknown,
  context?: Record<string, string>,
): void {
  if (__DEV__) {
    // Keep the dev-console mirror so local errors are still loud — Sentry
    // is disabled in dev by default (see `enabled` in initObservability),
    // so this is the only place a thrown error surfaces.
    // eslint-disable-next-line no-console
    console.error('[captureException]', error, context);
  }
  if (!_initialized) return;
  Sentry.captureException(error, context ? { tags: context } : undefined);
}

export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!_initialized) return;
  Sentry.addBreadcrumb({ category, message, data });
}
