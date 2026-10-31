/**
 * OpenTelemetry Tracing Bootstrap
 * ===============================
 * Exports distributed traces over OTLP/HTTP (protobuf) for the API.
 *
 * Strictly opt-in: nothing is registered unless `OTEL_EXPORTER_OTLP_ENDPOINT`
 * (or the traces-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set, so
 * local/dev runs are unaffected. All exporter/sampler/propagator configuration
 * comes from the standard `OTEL_*` environment variables read by the SDK
 * (OTEL_EXPORTER_OTLP_HEADERS, OTEL_TRACES_SAMPLER, OTEL_SDK_DISABLED, ...).
 * This module introduces no env vars of its own.
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
 * hooks), and pg statements are not enriched with parameters.
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

  try {
    sdk = new NodeSDK({
      serviceName: process.env['OTEL_SERVICE_NAME']?.trim() || DEFAULT_SERVICE_NAME,
      traceExporter: new OTLPTraceExporter(),
      // Traces only: the SDK would otherwise default metrics/logs to OTLP too.
      metricReaders: [],
      logRecordProcessors: [],
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: isNoisyRequest,
          // Skip outbound calls that have no parent span (background polling noise).
          requireParentforOutgoingSpans: true,
        }),
        new FastifyInstrumentation(),
        new NestInstrumentation(),
        new PgInstrumentation({ enhancedDatabaseReporting: false }),
        new IORedisInstrumentation(),
      ],
    });
    sdk.start();
    otelEnabled = true;

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
  }
  return otelEnabled;
}

/** Whether OpenTelemetry tracing is active in this process. */
export function isOtelEnabled(): boolean {
  return otelEnabled;
}

// Initialize on import so this module works as a preloaded side-effect import.
initOtel();
