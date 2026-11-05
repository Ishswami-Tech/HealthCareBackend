/**
 * Whether this process exports logs over OTLP.
 *
 * Set by `src/instrument/otel.ts` after the OpenTelemetry SDK starts with a log exporter
 * (`OTEL_LOGS_EXPORTER=otlp`), read by `otel-log-sink.ts`. Side-effect free on purpose so the
 * logging layer can depend on it without importing the SDK bootstrap.
 */

let otelLogsEnabled = false;

export function setOtelLogsEnabled(enabled: boolean): void {
  otelLogsEnabled = enabled;
}

export function isOtelLogsEnabled(): boolean {
  return otelLogsEnabled;
}
