/**
 * Trace sampling: OpenTelemetry samples parent-based at a production-safe ratio
 * unless ops configure the standard OTEL_TRACES_SAMPLER variables, health probes
 * are never traced, and Sentry sends no transactions of its own while
 * OpenTelemetry owns tracing (one pipeline, no double tracing).
 */
import {
  applyTraceSamplingDefaults,
  DEFAULT_PRODUCTION_TRACE_RATIO,
  isNoisyRequest,
} from '../../../src/instrument/otel';

describe('applyTraceSamplingDefaults', () => {
  it('defaults to parent-based 10% sampling in production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    applyTraceSamplingDefaults(env);
    expect(env['OTEL_TRACES_SAMPLER']).toBe('parentbased_traceidratio');
    expect(env['OTEL_TRACES_SAMPLER_ARG']).toBe(String(DEFAULT_PRODUCTION_TRACE_RATIO));
    expect(DEFAULT_PRODUCTION_TRACE_RATIO).toBe(0.1);
  });

  it('keeps every trace outside production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    applyTraceSamplingDefaults(env);
    expect(env['OTEL_TRACES_SAMPLER']).toBe('parentbased_traceidratio');
    expect(env['OTEL_TRACES_SAMPLER_ARG']).toBe('1');
  });

  it('never overrides a sampler that ops configured', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      OTEL_TRACES_SAMPLER: 'always_off',
    };
    applyTraceSamplingDefaults(env);
    expect(env['OTEL_TRACES_SAMPLER']).toBe('always_off');
    expect(env['OTEL_TRACES_SAMPLER_ARG']).toBeUndefined();
  });

  it('keeps a configured ratio and only fills in the sampler', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: '0.25' };
    applyTraceSamplingDefaults(env);
    expect(env['OTEL_TRACES_SAMPLER']).toBe('parentbased_traceidratio');
    expect(env['OTEL_TRACES_SAMPLER_ARG']).toBe('0.25');
  });

  it('treats a blank sampler as unset', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', OTEL_TRACES_SAMPLER: '  ' };
    applyTraceSamplingDefaults(env);
    expect(env['OTEL_TRACES_SAMPLER']).toBe('parentbased_traceidratio');
    expect(env['OTEL_TRACES_SAMPLER_ARG']).toBe('0.1');
  });
});

describe('isNoisyRequest', () => {
  it.each([
    '/health',
    '/health/',
    '/infra-health',
    '/api/v1/health?full=1',
    '/metrics',
    '/readiness',
  ])('skips probe endpoint %s', url => {
    expect(isNoisyRequest({ url })).toBe(true);
  });

  it.each(['/api/v1/appointments', '/api/v1/health-library/articles', '/api/v1/auth/verify-otp'])(
    'traces application route %s',
    url => {
      expect(isNoisyRequest({ url })).toBe(false);
    }
  );
});

describe('Sentry tracing while OpenTelemetry owns tracing', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
    jest.dontMock('../../../src/instrument/otel');
    jest.dontMock('@sentry/nestjs');
  });

  function initWith(otelEnabled: boolean): { tracesSampleRate?: number } {
    process.env = {
      ...ORIGINAL_ENV,
      SENTRY_DSN: 'https://public@example.invalid/1',
      SENTRY_ENVIRONMENT: 'production',
      SENTRY_TRACES_SAMPLE_RATE: '0.1',
    };
    const init = jest.fn();
    let options: { tracesSampleRate?: number } = {};
    jest.isolateModules(() => {
      jest.doMock('../../../src/instrument/otel', () => ({ isOtelEnabled: () => otelEnabled }));
      jest.doMock('@sentry/nestjs', () => ({
        init,
        openTelemetryIntegration: () => ({ name: 'OpenTelemetry' }),
        withScope: jest.fn(),
        captureException: jest.fn(),
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initSentry } = require('../../../src/instrument/sentry') as {
        initSentry: () => boolean;
      };
      initSentry();
      options = (init.mock.calls[0]?.[0] ?? {}) as { tracesSampleRate?: number };
    });
    return options;
  }

  it('sends no Sentry transactions when OpenTelemetry is active', () => {
    expect(initWith(true).tracesSampleRate).toBe(0);
  });

  it('uses SENTRY_TRACES_SAMPLE_RATE when OpenTelemetry is off', () => {
    expect(initWith(false).tracesSampleRate).toBe(0.1);
  });
});
