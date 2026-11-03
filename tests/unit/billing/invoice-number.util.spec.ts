import { describe, expect, it, jest } from '@jest/globals';
import {
  formatInvoiceNumber,
  isInvoiceNumberUniqueViolation,
  nextInvoiceSequence,
  withInvoiceNumberRetry,
} from '../../../src/services/billing/invoice-number.util';

function collision(): Error & { code: string; meta: { target: string[] } } {
  return Object.assign(new Error('Unique constraint failed on the fields: (`invoiceNumber`)'), {
    code: 'P2002',
    meta: { target: ['invoiceNumber'] },
  });
}

describe('invoice number helpers', () => {
  it('formats and sequences invoice numbers', () => {
    expect(formatInvoiceNumber(53, 2026)).toBe('INV-2026-000053');
    expect(nextInvoiceSequence(52)).toBe(53);
    expect(nextInvoiceSequence('52')).toBe(53);
    expect(nextInvoiceSequence(BigInt(7))).toBe(8);
    expect(nextInvoiceSequence(null)).toBe(1);
    expect(nextInvoiceSequence('garbage')).toBe(1);
  });

  it('recognises only invoiceNumber unique violations', () => {
    expect(isInvoiceNumberUniqueViolation(collision())).toBe(true);
    expect(
      isInvoiceNumberUniqueViolation({
        code: 'P2002',
        message: 'Unique constraint failed',
        meta: { constraint: 'Invoice_invoiceNumber_key' },
      })
    ).toBe(true);
    expect(
      isInvoiceNumberUniqueViolation({ code: 'P2002', message: 'x', meta: { target: ['id'] } })
    ).toBe(false);
    expect(isInvoiceNumberUniqueViolation({ code: 'P2025', message: 'invoiceNumber' })).toBe(false);
    expect(isInvoiceNumberUniqueViolation(null)).toBe(false);
  });

  it('retries a collision with a fresh attempt and returns the first success', async () => {
    const onCollision = jest.fn<(attempt: number, max: number) => void>();
    let calls = 0;
    const result = await withInvoiceNumberRetry(
      attempt => {
        calls += 1;
        if (attempt < 3) {
          return Promise.reject(collision());
        }
        return Promise.resolve(formatInvoiceNumber(attempt, 2026));
      },
      { maxAttempts: 3, onCollision }
    );
    expect(result).toBe('INV-2026-000003');
    expect(calls).toBe(3);
    expect(onCollision).toHaveBeenCalledTimes(2);
    expect(onCollision).toHaveBeenNthCalledWith(1, 1, 3);
  });

  it('rethrows the last collision once attempts are exhausted', async () => {
    let calls = 0;
    await expect(
      withInvoiceNumberRetry(
        () => {
          calls += 1;
          return Promise.reject(collision());
        },
        { maxAttempts: 2 }
      )
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(calls).toBe(2);
  });

  it('never retries an unrelated error', async () => {
    let calls = 0;
    await expect(
      withInvoiceNumberRetry(() => {
        calls += 1;
        return Promise.reject(new Error('connection lost'));
      })
    ).rejects.toThrow('connection lost');
    expect(calls).toBe(1);
  });
});
