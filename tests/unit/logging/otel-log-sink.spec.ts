import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { logs, SeverityNumber } from '@opentelemetry/api';
import { LogLevel, LogType } from '@core/types/logging.types';
import {
  MAX_OTEL_ATTRIBUTES,
  MAX_OTEL_STRING_LENGTH,
  emitOtelLog,
  toOtelLogRecord,
} from '@infrastructure/logging/otel-log-sink';
import { setOtelLogsEnabled } from '@infrastructure/logging/otel-log-state';

const entry = (metadata: Record<string, unknown> = {}, level = LogLevel.INFO) => ({
  type: LogType.SYSTEM,
  level,
  message: 'Appointment created',
  context: 'AppointmentsService',
  metadata,
});

describe('toOtelLogRecord', () => {
  it('maps level, body, type and context', () => {
    const record = toOtelLogRecord(entry({}, LogLevel.WARN));
    expect(record.severityNumber).toBe(SeverityNumber.WARN);
    expect(record.severityText).toBe('WARN');
    expect(record.body).toBe('Appointment created');
    expect(record.attributes).toMatchObject({
      'log.type': 'SYSTEM',
      'log.context': 'AppointmentsService',
    });
  });

  it('maps every LogLevel to a severity', () => {
    expect(toOtelLogRecord(entry({}, LogLevel.ERROR)).severityNumber).toBe(SeverityNumber.ERROR);
    expect(toOtelLogRecord(entry({}, LogLevel.DEBUG)).severityNumber).toBe(SeverityNumber.DEBUG);
    expect(toOtelLogRecord(entry({}, LogLevel.VERBOSE)).severityNumber).toBe(SeverityNumber.TRACE);
    expect(toOtelLogRecord(entry({}, LogLevel.TRACE)).severityNumber).toBe(SeverityNumber.TRACE);
  });

  it('keeps primitive metadata, serialises objects and drops empty values', () => {
    const record = toOtelLogRecord(
      entry({
        clinicId: 'clinic-1',
        durationMs: 42,
        cached: false,
        details: { status: 409, reason: 'slot taken' },
        missing: undefined,
        empty: null,
      })
    );
    expect(record.attributes).toMatchObject({
      clinicId: 'clinic-1',
      durationMs: 42,
      cached: false,
      details: '{"status":409,"reason":"slot taken"}',
    });
    expect(record.attributes).not.toHaveProperty('missing');
    expect(record.attributes).not.toHaveProperty('empty');
  });

  it('bounds attribute count and string length', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_OTEL_ATTRIBUTES + 25 }, (_, i) => [`k${i}`, i])
    );
    const record = toOtelLogRecord(
      entry({ ...many, long: 'x'.repeat(MAX_OTEL_STRING_LENGTH + 500) })
    );
    expect(Object.keys(record.attributes ?? {}).length).toBeLessThanOrEqual(MAX_OTEL_ATTRIBUTES);

    const longOnly = toOtelLogRecord(entry({ long: 'x'.repeat(MAX_OTEL_STRING_LENGTH + 500) }));
    expect(String(longOnly.attributes?.['long']).length).toBe(MAX_OTEL_STRING_LENGTH);
    const longBody = toOtelLogRecord({
      ...entry(),
      message: 'm'.repeat(MAX_OTEL_STRING_LENGTH * 3),
    });
    expect(String(longBody.body).length).toBe(MAX_OTEL_STRING_LENGTH * 2);
  });

  it('does not throw on circular metadata', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(() => toOtelLogRecord(entry({ circular }))).not.toThrow();
    expect(toOtelLogRecord(entry({ circular })).attributes?.['circular']).toBe('[unserialisable]');
  });
});

describe('emitOtelLog', () => {
  afterEach(() => {
    setOtelLogsEnabled(false);
    jest.restoreAllMocks();
  });

  it('is a no-op while OTLP log export is off', () => {
    const getLogger = jest.spyOn(logs, 'getLogger');
    emitOtelLog(entry());
    expect(getLogger).not.toHaveBeenCalled();
  });

  it('emits through the OTel Logs API once log export is on', () => {
    const emit = jest.fn();
    jest.spyOn(logs, 'getLogger').mockReturnValue({ emit } as never);
    setOtelLogsEnabled(true);
    emitOtelLog(entry({ clinicId: 'clinic-1' }, LogLevel.ERROR));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      severityNumber: SeverityNumber.ERROR,
      body: 'Appointment created',
      attributes: { clinicId: 'clinic-1' },
    });
  });

  it('never throws when the OTel logger fails', () => {
    jest.spyOn(logs, 'getLogger').mockReturnValue({
      emit: () => {
        throw new Error('exporter down');
      },
    } as never);
    setOtelLogsEnabled(true);
    expect(() => emitOtelLog(entry())).not.toThrow();
  });
});
