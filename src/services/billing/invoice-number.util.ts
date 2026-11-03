/**
 * Invoice numbers: `INV-<year>-<sequence>` where the sequence is one more than the highest
 * sequence already used. Allocation runs inside the invoice-create transaction under a
 * transaction-scoped advisory lock; `Invoice.invoiceNumber` is UNIQUE, so if two allocations ever
 * pick the same number the second insert fails with P2002 and is retried with a fresh number.
 */

export const INVOICE_NUMBER_MAX_ATTEMPTS = 3;

/** Advisory lock key serialising invoice-number allocation (any constant bigint works). */
export const INVOICE_NUMBER_LOCK_KEY = 2026032901;

export function formatInvoiceNumber(sequence: number, year: number): string {
  return `INV-${year}-${sequence.toString().padStart(6, '0')}`;
}

/** The next sequence after the highest one in use (a NULL / garbage max starts at 1). */
export function nextInvoiceSequence(
  maxSequenceRaw: number | string | bigint | null | undefined
): number {
  const maxSequence = Number(maxSequenceRaw ?? 0);
  return Number.isFinite(maxSequence) && maxSequence >= 0 ? Math.floor(maxSequence) + 1 : 1;
}

function targetMentionsInvoiceNumber(target: unknown): boolean {
  if (typeof target === 'string') {
    return target.includes('invoiceNumber');
  }
  return Array.isArray(target) && target.some(field => String(field).includes('invoiceNumber'));
}

/** A Prisma unique-constraint violation (P2002) on `Invoice.invoiceNumber`. */
export function isInvoiceNumberUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { code?: unknown; message?: unknown; meta?: unknown };
  if (record.code !== 'P2002') {
    return false;
  }
  const message = typeof record.message === 'string' ? record.message : '';
  const meta =
    record.meta && typeof record.meta === 'object'
      ? (record.meta as { target?: unknown; constraint?: unknown })
      : {};
  return (
    message.includes('invoiceNumber') ||
    targetMentionsInvoiceNumber(meta.target) ||
    targetMentionsInvoiceNumber(meta.constraint)
  );
}

/**
 * Runs `create` until it does not collide on the invoice number, at most `maxAttempts` times.
 * Any other error, or the last collision, is rethrown.
 */
export async function withInvoiceNumberRetry<T>(
  create: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    onCollision?: (attempt: number, maxAttempts: number) => Promise<void> | void;
  } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? INVOICE_NUMBER_MAX_ATTEMPTS);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await create(attempt);
    } catch (error) {
      if (!isInvoiceNumberUniqueViolation(error) || attempt >= maxAttempts) {
        throw error;
      }
      await options.onCollision?.(attempt, maxAttempts);
    }
  }
}
