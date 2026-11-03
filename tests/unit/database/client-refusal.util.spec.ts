import { describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { HealthcareError } from '../../../src/libs/core/errors/healthcare-error.class';
import { ErrorCode } from '../../../src/libs/core/errors/error-codes.enum';
import { isClientRefusal } from '../../../src/libs/infrastructure/database/internal/client-refusal.util';

describe('isClientRefusal (B2)', () => {
  it('treats 4xx HttpExceptions from business code as refusals to pass through', () => {
    expect(isClientRefusal(new BadRequestException('Cash amount exceeds pending amount'))).toBe(
      true
    );
    expect(isClientRefusal(new NotFoundException('Prescription not found'))).toBe(true);
    expect(isClientRefusal(new ConflictException('Already dispensed'))).toBe(true);
    expect(
      isClientRefusal(
        new HealthcareError(
          ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
          'Insufficient stock for Paracetamol',
          HttpStatus.CONFLICT
        )
      )
    ).toBe(true);
  });

  it('keeps wrapping real failures (5xx and plain errors)', () => {
    expect(isClientRefusal(new InternalServerErrorException('boom'))).toBe(false);
    expect(
      isClientRefusal(
        new HealthcareError(ErrorCode.DATABASE_QUERY_FAILED, 'Write operation failed')
      )
    ).toBe(false);
    expect(isClientRefusal(new Error('connection reset'))).toBe(false);
    expect(isClientRefusal('nope')).toBe(false);
  });
});
