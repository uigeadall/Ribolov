/**
 * Observability — no-op stub.
 *
 * Sentry was removed by user request (cost concern). The function
 * signatures are kept so existing call sites compile unchanged; errors
 * now flow only to the dev console. The ErrorBoundary still renders
 * its fallback UI on a React tree crash — users get a recoverable
 * screen rather than a white death — but the crash report doesn't go
 * anywhere.
 *
 * If you ever want a free crash reporter back, options:
 *   - Sentry (5k events/mo free) → re-add @sentry/react-native and
 *     restore the previous shape from git history (commit 50cb7be).
 *   - expo-error-recovery → in-process restart on crash, no remote.
 *   - Firebase Crashlytics → free, native-only, needs @react-native-
 *     firebase/crashlytics; integrates with the existing Firebase setup.
 */

let _initialized = false;

export function initObservability(): void {
  _initialized = true;
}

export function setObservabilityUser(
  _uid: string | null,
  _displayName?: string | null,
): void {
  if (!_initialized) return;
}

export function captureException(
  error: unknown,
  context?: Record<string, string>,
): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[captureException]', error, context);
  }
}

export function addBreadcrumb(
  _category: string,
  _message: string,
  _data?: Record<string, unknown>,
): void {
  if (!_initialized) return;
}
