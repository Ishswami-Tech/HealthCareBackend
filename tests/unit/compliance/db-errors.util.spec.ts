import { describe, it, expect } from '@jest/globals';
import { isUniqueViolation } from '../../../src/services/compliance/utils/db-errors.util';

describe('isUniqueViolation', () => {
  it('recognises a raw Prisma error', () => {
    expect(isUniqueViolation({ code: 'P2002', message: 'x' })).toBe(true);
  });

  it('recognises the generic error DatabaseService rewraps everything as', () => {
    const wrapped = Object.assign(new Error('Write operation failed: boom'), {
      code: 'DATABASE_QUERY_FAILED',
      metadata: {
        originalError:
          'Invalid `prisma.patientConsent.create()` invocation: Unique constraint failed on the fields: (`patientId`,`clinicId`,`purpose`,`version`)',
      },
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('recognises the wrapped form after retries and a Postgres message', () => {
    expect(
      isUniqueViolation({
        message: 'Write operation failed after 3 attempts: duplicate key value violates unique constraint "x"',
      })
    ).toBe(true);
    expect(isUniqueViolation({ metadata: { originalErrorMessage: 'Unique constraint failed' } })).toBe(
      true
    );
  });

  it('follows a cause chain but not forever', () => {
    expect(isUniqueViolation({ message: 'outer', cause: { code: 'P2002' } })).toBe(true);
    const loop: { cause?: unknown; message: string } = { message: 'loop' };
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });

  it('does not match unrelated errors, and tolerates non-errors', () => {
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isUniqueViolation({ code: 'P2025', message: 'record not found' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('P2002')).toBe(false);
  });
});
