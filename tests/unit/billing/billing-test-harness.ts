/// <reference types="jest" />
/**
 * Shared construction helper for the BillingService unit specs.
 *
 * The importing spec MUST register the module mocks below (jest.mock is hoisted per file):
 *
 *   jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
 *   jest.mock('@payment/payment.handoff-token.service', () => ({ PaymentHandoffTokenService: class {} }), { virtual: true });
 *   jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
 *
 * jest.config.unit.ts has no `@payment` alias, and BillingService only needs the classes as
 * injection tokens, so they are stubbed instead of loading the real provider modules.
 */
import { BillingService } from '@services/billing/billing.service';

export type MockFn = jest.Mock<Promise<unknown>, unknown[]>;
export type MockMap = Record<string, jest.Mock>;

export interface BillingHarnessOverrides {
  databaseService?: MockMap;
  cacheService?: MockMap;
  loggingService?: MockMap;
  eventService?: MockMap;
  paymentService?: MockMap;
  configService?: MockMap;
}

/** A CacheService.cache() stand-in that really caches: a warm key never calls the loader. */
export function createWarmableCache(): { store: Map<string, unknown>; cache: jest.Mock } {
  const store = new Map<string, unknown>();
  const cache = jest.fn(async (key: string, loader: () => Promise<unknown>) => {
    if (store.has(key)) {
      return store.get(key);
    }
    const value = await loader();
    store.set(key, value);
    return value;
  });
  return { store, cache };
}

export function createBillingService(overrides: BillingHarnessOverrides = {}): {
  service: BillingService;
  databaseService: MockMap;
  cacheService: MockMap;
  loggingService: MockMap;
  eventService: MockMap;
  paymentService: MockMap;
  configService: MockMap;
} {
  const databaseService: MockMap = overrides.databaseService ?? {};
  const cacheService: MockMap = overrides.cacheService ?? {
    cache: jest.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    invalidateCacheByTag: jest.fn().mockResolvedValue(0),
  };
  if (!cacheService['invalidateCacheByTag']) {
    cacheService['invalidateCacheByTag'] = jest.fn().mockResolvedValue(0);
  }
  const loggingService: MockMap = overrides.loggingService ?? {
    log: jest.fn().mockResolvedValue(undefined),
  };
  const eventService: MockMap = overrides.eventService ?? {
    emit: jest.fn().mockResolvedValue(undefined),
    emitEnterprise: jest.fn().mockResolvedValue(undefined),
  };
  const paymentService: MockMap = overrides.paymentService ?? {};
  const configService: MockMap = overrides.configService ?? {
    getEnv: jest.fn().mockReturnValue(undefined),
    getAppConfig: jest.fn().mockReturnValue({ baseUrl: '' }),
  };

  const service = new BillingService(
    databaseService as never,
    cacheService as never,
    loggingService as never,
    eventService as never,
    {} as never,
    {} as never,
    paymentService as never,
    {} as never,
    configService as never,
    {} as never,
    undefined
  );

  return {
    service,
    databaseService,
    cacheService,
    loggingService,
    eventService,
    paymentService,
    configService,
  };
}
