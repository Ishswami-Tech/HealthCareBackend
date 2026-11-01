import { describe, expect, it } from '@jest/globals';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { isDeterministicDatabaseError } from '../../../src/libs/infrastructure/database/internal/retryable-error.util';

function prismaError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.name = 'PrismaClientKnownRequestError';
  error.code = code;
  return error;
}

describe('isDeterministicDatabaseError', () => {
  it('never retries a unique-constraint violation (users_phone_key, clinic-day 2026-10-31)', () => {
    const error = prismaError(
      'P2002',
      'Invalid prisma.user.create() invocation: Unique constraint failed on the constraint: users_phone_key'
    );
    expect(isDeterministicDatabaseError(error)).toBe(true);
  });

  it('treats other P2xxx request errors (FK violation, record not found) as deterministic', () => {
    expect(isDeterministicDatabaseError(prismaError('P2003', 'Foreign key constraint'))).toBe(true);
    expect(isDeterministicDatabaseError(prismaError('P2025', 'Record not found'))).toBe(true);
  });

  it('keeps pool timeouts and write conflicts retryable', () => {
    expect(
      isDeterministicDatabaseError(prismaError('P2024', 'Timed out fetching a connection'))
    ).toBe(false);
    expect(isDeterministicDatabaseError(prismaError('P2034', 'Write conflict or deadlock'))).toBe(
      false
    );
  });

  it('keeps connection-level errors retryable', () => {
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:5432') as Error & { code: string };
    refused.code = 'ECONNREFUSED';
    expect(isDeterministicDatabaseError(refused)).toBe(false);
    expect(isDeterministicDatabaseError(prismaError('P1001', 'Cannot reach database server'))).toBe(
      false
    );
  });

  it('does not retry a 4xx refusal raised inside the callback, but a 5xx stays retryable', () => {
    expect(isDeterministicDatabaseError(new ConflictException('Already dispensed'))).toBe(true);
    expect(isDeterministicDatabaseError(new ServiceUnavailableException('down'))).toBe(false);
  });
});
