import * as Sentry from '@sentry/react-native';

let sentryReady = false;

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** DSN от EXPO_PUBLIC_SENTRY_DSN или app.json extra.sentryDsn */
export function getSentryDsn(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as typeof import('expo-constants').default;
    const e = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    return trimStr(e.sentryDsn) || trimStr(process.env.EXPO_PUBLIC_SENTRY_DSN);
  } catch {
    return trimStr(process.env.EXPO_PUBLIC_SENTRY_DSN);
  }
}

/** Извикай веднъж при стартиране на приложението (преди UI). */
export function initObservability(): void {
  if (sentryReady) return;
  const dsn = getSentryDsn();
  if (!dsn) {
    sentryReady = true;
    return;
  }
  try {
    Sentry.init({
      dsn,
      enabled: true,
      enableAutoSessionTracking: true,
      tracesSampleRate: __DEV__ ? 0.15 : 0.25,
      attachStacktrace: true,
    });
    sentryReady = true;
  } catch {
    sentryReady = true;
  }
}

export function captureException(error: unknown, context?: Record<string, string>): void {
  try {
    if (!getSentryDsn()) {
      // eslint-disable-next-line no-console
      console.error('[captureException]', error, context);
      return;
    }
    Sentry.withScope((scope) => {
      if (context) {
        Object.entries(context).forEach(([k, v]) => scope.setTag(k, v));
      }
      Sentry.captureException(error);
    });
  } catch {
    /* ignore */
  }
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  try {
    if (!getSentryDsn()) return;
    Sentry.captureMessage(message, level);
  } catch {
    /* ignore */
  }
}

export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  try {
    if (!getSentryDsn()) return;
    Sentry.addBreadcrumb({ category, message, data, level: 'info' });
  } catch {
    /* ignore */
  }
}

export async function flushObservability(): Promise<void> {
  try {
    await Sentry.flush();
  } catch {
    /* ignore */
  }
}
