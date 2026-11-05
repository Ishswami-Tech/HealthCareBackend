/**
 * OpenTelemetry Bootstrap
 * =======================
 * Exports distributed traces over OTLP/HTTP (protobuf) for the API and worker,
 * and optionally metrics and logs (e.g. to a self-hosted ClickStack collector;
 * see devops/observability/README.md).
 *
 * Strictly opt-in: nothing is registered unless `OTEL_EXPORTER_OTLP_ENDPOINT`
 * (or the traces-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set, so
 * local/dev runs are unaffected. All exporter/sampler/propagator configuration
 * comes from the standard `OTEL_*` environment variables read by the SDK
 * (OTEL_EXPORTER_OTLP_HEADERS, OTEL_TRACES_SAMPLER, OTEL_SDK_DISABLED, ...).
 * This module introduces no env vars of its own.
 *
 * Signals: traces are on whenever an endpoint is set. Metrics and logs stay off
 * unless their standard variable names an exporter (`OTEL_METRICS_EXPORTER=otlp`,
 * `OTEL_LOGS_EXPORTER=otlp`); the SDK would otherwise default both to OTLP, which
 * would change behaviour for deployments that only expect traces. Log records
 * come from LoggingService after its central redaction (see
 * `@infrastructure/logging/otel-log-sink`).
 *
 * IMPORTANT: must load before Sentry and before any instrumented library
 * (http, pg, ioredis, fastify, @nestjs/core). It is imported first by
 * `./sentry`, which both entrypoints (main.ts, worker-bootstrap.ts) load first.
 * It is dependency-free of NestJS DI, so it cannot use LoggingService.
 *
 * Coexistence with Sentry v11: Sentry does not register an OpenTelemetry
 * tracer provider unless `enableOpenTelemetrySetup` is true (it is not set), so
 * this NodeSDK owns the global provider with no conflict. `sentry.ts` adds
 * `openTelemetryIntegration()` when this is active so errors carry the active
 * OTel trace id.
 *
 * Privacy: only structural spans are produced. No request/response bodies or
 * headers are recorded (no header-to-attribute mapping, no request/response
 * hooks), and pg statements are not enriched with parameters. HTTP query
 * strings and Redis keys are redacted (`@infrastructure/logging/otel-redaction`).
 *
 * @module OtelInstrument
 */

import type { IncomingMessage } from 'http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { setOtelLogsEnabled } from '@infrastructure/logging/otel-log-state';
import {
  incomingSpanUrlAttributes,
  outgoingSpanUrlAttributes,
  redisStatementSerializer,
} from '@infrastructure/logging/otel-redaction';

const DEFAULT_SERVICE_NAME = 'healthcare-api';

/** Probe/scrape endpoints that would only add noise (and cost) to traces. */
const NOISY_PATH = /\/(health|healthz|ready|readiness|live|liveness|ping|metrics)\/?$/i;

let otelEnabled = false;
let sdk: NodeSDK | undefined;

function hasOtlpEndpoint(): boolean {
  const base = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  const traces = process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim();
  return Boolean(base) || Boolean(traces);
}

/** True when a signal's standard OTEL_*_EXPORTER variable names an exporter (not empty/none). */
function isSignalRequested(name: 'OTEL_METRICS_EXPORTER' | 'OTEL_LOGS_EXPORTER'): boolean {
  const exporters = (process.env[name] ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return exporters.length > 0 && !exporters.includes('none');
}

function isNoisyRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? '').split('?')[0] ?? '';
  return NOISY_PATH.test(path);
}

/**
 * Start the OpenTelemetry SDK when an OTLP endpoint is configured.
 * @returns true when tracing was started, false when it is a no-op.
 */
export function initOtel(): boolean {
  if (otelEnabled || !hasOtlpEndpoint()) {
    return otelEnabled;
  }
  if (process.env['OTEL_SDK_DISABLED']?.trim().toLowerCase() === 'true') {
    return false;
  }

  const metricsRequested = isSignalRequested('OTEL_METRICS_EXPORTER');
  const logsRequested = isSignalRequested('OTEL_LOGS_EXPORTER');

  try {
    sdk = new NodeSDK({
      serviceName: process.env['OTEL_SERVICE_NAME']?.trim() || DEFAULT_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter(),
      // Metrics/logs only when explicitly requested; otherwise pass empty lists so the SDK
      // does not default them to OTLP. When requested, the SDK builds them from OTEL_* env.
      ...(metricsRequested ? {} : { metricReaders: [] }),
      ...(logsRequested ? {} : { logRecordProcessors: [] }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: isNoisyRequest,
          // Skip outbound calls that have no parent span (background polling noise).
          requireParentforOutgoingSpans: true,
          // Query strings carry phones, emails, search text and third-party tokens.
          startIncomingSpanHook: incomingSpanUrlAttributes,
          startOutgoingSpanHook: outgoingSpanUrlAttributes,
        }),
        new FastifyInstrumentation(),
        new NestInstrumentation(),
        new PgInstrumentation({ enhancedDatabaseReporting: false }),
        // Redis keys embed identifiers (otp:<email>, session ids): record the command only.
        new IORedisInstrumentation({ dbStatementSerializer: redisStatementSerializer }),
      ],
    });
    sdk.start();
    otelEnabled = true;
    setOtelLogsEnabled(logsRequested);

    const shutdown = (): void => {
      void sdk?.shutdown().catch(() => undefined);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    // Telemetry must never prevent the API from booting.
    process.stderr.write(
      `[otel] tracing disabled, SDK failed to start: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`
    );
    sdk = undefined;
    otelEnabled = false;
    setOtelLogsEnabled(false);
  }
  return otelEnabled;
}

/** Whether OpenTelemetry tracing is active in this process. */
export function isOtelEnabled(): boolean {
  return otelEnabled;
}

// Initialize on import so this module works as a preloaded side-effect import.
initOtel();
