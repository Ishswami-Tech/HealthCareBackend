/// <reference types="jest" />
/**
 * One invoice WhatsApp per invoice across API copies.
 *
 * The 60 s "recently sent" marker is written only after a send finishes and the in-process lock
 * covers one copy only, so two requests for the same invoice landing on two API copies (a
 * double click, or the payment webhook and a reception click) both messaged the patient. A
 * shared lock now makes the second copy wait for the first one's result.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class {} }));
jest.mock('@services/billing/invoice-pdf.service', () => ({ InvoicePDFService: class {} }));

import { createBillingService } from './billing-test-harness';

type LockFn = (invoiceId: string, task: () => Promise<boolean>) => Promise<boolean>;

/** A Dragonfly stand-in shared by every copy: get/set plus SET NX locks. */
function sharedCache() {
  const values = new Map<string, string>();
  return {
    cache: jest.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    invalidateCacheByTag: jest.fn().mockResolvedValue(0),
    get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    acquireLock: jest.fn((key: string) => {
      if (values.has(key)) return Promise.resolve(false);
      values.set(key, '1');
      return Promise.resolve(true);
    }),
    releaseLock: jest.fn((key: string) => Promise.resolve(values.delete(key))),
  };
}

function copyWith(cache: ReturnType<typeof sharedCache>): LockFn {
  const { service } = createBillingService({ cacheService: cache as never });
  const lock = (service as unknown as { withInvoiceWhatsAppSendLock: LockFn })
    .withInvoiceWhatsAppSendLock;
  return lock.bind(service);
}

describe('invoice WhatsApp send lock across API copies', () => {
  it('sends once when two copies get the same invoice at the same time', async () => {
    const cache = sharedCache();
    const copyA = copyWith(cache);
    const copyB = copyWith(cache);
    let releaseSend: (sent: boolean) => void = () => undefined;
    const sendA = jest.fn(
      () =>
        new Promise<boolean>(resolve => {
          releaseSend = resolve;
        })
    );
    const sendB = jest.fn(() => Promise.resolve(true));

    const resultA = copyA('inv-1', sendA);
    await new Promise(resolve => setImmediate(resolve)); // A holds the lock, its send is running
    const resultB = copyB('inv-1', sendB);
    releaseSend(true);

    await expect(resultA).resolves.toBe(true);
    await expect(resultB).resolves.toBe(true);
    expect(sendA).toHaveBeenCalledTimes(1);
    expect(sendB).not.toHaveBeenCalled();
  });

  it('releases the lock, so a later send of another invoice is not blocked', async () => {
    const cache = sharedCache();
    const copyA = copyWith(cache);

    await expect(copyA('inv-1', () => Promise.resolve(true))).resolves.toBe(true);
    await expect(copyA('inv-2', () => Promise.resolve(false))).resolves.toBe(false);
    expect(cache.releaseLock).toHaveBeenCalledTimes(2);
  });

  it('still sends when the shared cache cannot be reached', async () => {
    const cache = sharedCache();
    cache.acquireLock.mockRejectedValue(new Error('cache down'));
    const send = jest.fn(() => Promise.resolve(true));

    await expect(copyWith(cache)('inv-1', send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
