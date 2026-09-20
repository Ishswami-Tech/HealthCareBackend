/**
 * Sentry Instrumentation
 * ======================
 * Initializes the Sentry SDK for backend error tracking.
 *
 * IMPORTANT: This file must be imported BEFORE any other module in the
 * application entrypoint (main.ts) so Sentry's auto-instrumentation can patch
 * NestJS, HTTP, and other libraries before they are loaded. It is intentionally
 * dependency-free (no NestJS DI / ConfigService) and reads configuration from
 * `process.env`, which dotenv/dotenvx has already populated at process start.
 *
 * The DSN falls back to the project's Sentry project so error reporting works
 * out of the box, but any environment can override it (or disable Sentry) via
 * the `SENTRY_DSN` env var. Set `SENTRY_DSN=""` (empty) to fully disable.
 *
 * @module SentryInstrument
 * @see https://docs.sentry.io/platforms/javascript/guides/nestjs/
 */

import * as Sentry from '@sentry/nestjs';

/**
 * Default DSN for the shared Sentry project. Overridable via SENTRY_DSN.
 * A DSN is not a secret credential (it only permits sending events), so it is
 * safe to keep as a fallback here; still prefer setting SENTRY_DSN per env.
 */
const DEFAULT_SENTRY_DSN =
  'https://e07259d1a50f942cac51e9e6c977bb82@o4511786368696320.ingest.de.sentry.io/4512065177452624';

/** Whether Sentry was actually initialized. */
let sentryEnabled = false;

function resolveDsn(): string {
  // Explicit empty string disables Sentry; undefined falls back to the default.
  const fromEnv = process.env['SENTRY_DSN'];
  if (fromEnv !== undefined) {
    return fromEnv.trim();
  }
  return DEFAULT_SENTRY_DSN;
}

function parseRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

/**
 * Initialize Sentry if a DSN is configured. No-ops (returns false) when the DSN
 * resolves to an empty string.
 */
export function initSentry(): boolean {
  const dsn = resolveDsn();
  if (!dsn) {
    return false;
  }

  const environment = process.env['SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
  const isProd = environment === 'production';

  // Performance tracing is opt-in; default a low prod rate and off elsewhere.
  const tracesSampleRate = parseRate(process.env['SENTRY_TRACES_SAMPLE_RATE'], isProd ? 0.1 : 0);

  Sentry.init({
    dsn,
    environment,
    ...(process.env['SENTRY_RELEASE'] ? { release: process.env['SENTRY_RELEASE'] } : {}),
    tracesSampleRate,
    // Do not attach default PII (IP, cookies, request headers). The exception
    // filter forwards a scrubbed context explicitly instead.
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
  });

  sentryEnabled = true;
  return true;
}

/** Whether Sentry is active in this process. */
export function isSentryEnabled(): boolean {
  return sentryEnabled;
}

/**
 * Report an exception to Sentry. No-op when Sentry is not initialized.
 *
 * Centralized so all capture goes through one gate. Callers (e.g.
 * HealthcareErrorsService) decide WHICH errors are worth sending — this only
 * forwards. Extra structured context is attached as tags/extras; do not pass
 * raw PII here (callers already scrub).
 *
 * @param error   The error/exception to capture
 * @param context Optional structured context: `level`, `tags`, `extra`, `fingerprint`
 */
export function captureError(
  error: unknown,
  context?: {
    level?: 'fatal' | 'error' | 'warning' | 'info';
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    fingerprint?: string[];
  }
): void {
  if (!sentryEnabled) {
    return;
  }
  try {
    Sentry.withScope(scope => {
      if (context?.level) {
        scope.setLevel(context.level);
      }
      if (context?.tags) {
        scope.setTags(context.tags);
      }
      if (context?.extra) {
        scope.setExtras(context.extra);
      }
      if (context?.fingerprint) {
        scope.setFingerprint(context.fingerprint);
      }
      // Real Error instances preserve stack traces; anything else is captured as a message.
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureException(
          new Error(typeof error === 'string' ? error : JSON.stringify(error))
        );
      }
    });
  } catch {
    // Never let telemetry break the request/flow.
  }
}

// Initialize on import so this module works as a preloaded side-effect import.
initSentry();
