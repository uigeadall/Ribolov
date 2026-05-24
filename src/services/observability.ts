/**
 * Observability stub. Sentry was removed for cost reasons — this module
 * preserves the public API (initObservability / setObservabilityUser /
 * captureException / addBreadcrumb) so the ~14 call sites across the
 * codebase keep compiling without churn. If we later wire a different error
 * reporter, slot the implementation in here and every existing call site
 * picks it up automatically.
 *
 * captureException still logs to the console in dev so unexpected errors
 * surface during development; everything else is a silent no-op.
 */

export function initObservability(): void {
  /* no-op — Sentry removed */
}

export function setObservabilityUser(
  _uid: string | null,
  _displayName?: string | null,
): void {
  /* no-op — Sentry removed */
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
  /* no-op — Sentry removed */
}
