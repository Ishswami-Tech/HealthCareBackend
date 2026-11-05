/**
 * OpenTelemetry log sink for LoggingService.
 *
 * Forwards log entries to the OTel Logs API when OTLP log export is on (see
 * `src/instrument/otel.ts` and `otel-log-state.ts`); a no-op otherwise. LoggingService calls it
 * with the entry AFTER central redaction (log-redaction.util.ts), so phones, emails, OTPs and
 * tokens are already masked. The SDK attaches the active span context, so in ClickStack each log
 * line links to the trace of the request that produced it.
 *
 * Attributes are bounded (count and string length) to keep ClickHouse rows small and cardinality
 * predictable. Telemetry must never break logging, so every failure is swallowed.
 */

import { logs, SeverityNumber } from '@opentelemetry/api';
import type { Attributes, LogRecord } from '@opentelemetry/api';
import { LogLevel } from '@core/types/logging.types';
import { isOtelLogsEnabled } from '@infrastructure/logging/otel-log-state';

export const MAX_OTEL_ATTRIBUTES = 40;
export const MAX_OTEL_STRING_LENGTH = 2000;
const OTEL_LOGGER_NAME = 'healthcare-logging';

const SEVERITY_BY_LEVEL: Record<LogLevel, SeverityNumber> = {
  [LogLevel.ERROR]: SeverityNumber.ERROR,
  [LogLevel.WARN]: SeverityNumber.WARN,
  [LogLevel.INFO]: SeverityNumber.INFO,
  [LogLevel.DEBUG]: SeverityNumber.DEBUG,
  [LogLevel.VERBOSE]: SeverityNumber.TRACE,
  [LogLevel.TRACE]: SeverityNumber.TRACE,
};

export interface OtelLogInput {
  type: string;
  level: LogLevel;
  message: string;
  context: string;
  metadata: Record<string, unknown>;
}

function clip(value: string, max: number = MAX_OTEL_STRING_LENGTH): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Scalar attribute values only: objects are serialised, so ClickHouse columns stay flat. */
type OtelAttributeValue = string | number | boolean;

function toAttributeValue(value: unknown): OtelAttributeValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return clip(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return clip(JSON.stringify(value) ?? '');
  } catch {
    return '[unserialisable]';
  }
}

/** Builds the OTel log record for an already-redacted LoggingService entry. */
export function toOtelLogRecord(entry: OtelLogInput): LogRecord {
  const attributes: Attributes = {
    'log.type': entry.type,
    'log.context': entry.context,
  };
  let count = Object.keys(attributes).length;
  for (const [key, raw] of Object.entries(entry.metadata)) {
    if (count >= MAX_OTEL_ATTRIBUTES) {
      break;
    }
    const value = toAttributeValue(raw);
    if (value !== undefined) {
      attributes[key] = value;
      count += 1;
    }
  }
  return {
    severityNumber: SEVERITY_BY_LEVEL[entry.level] ?? SeverityNumber.INFO,
    severityText: entry.level,
    body: clip(entry.message, MAX_OTEL_STRING_LENGTH * 2),
    attributes,
  };
}

/** Emits the entry through the OTel Logs API when OTLP log export is on. Never throws. */
export function emitOtelLog(entry: OtelLogInput): void {
  if (!isOtelLogsEnabled()) {
    return;
  }
  try {
    logs.getLogger(OTEL_LOGGER_NAME).emit(toOtelLogRecord(entry));
  } catch {
    // Telemetry must never break logging.
  }
}
