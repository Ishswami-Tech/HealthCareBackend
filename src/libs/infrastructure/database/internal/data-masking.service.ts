/**
 * Data Masking Service
 * @class DataMaskingService
 * @description Masks sensitive data (PHI) for logging and non-production environments
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';

export interface MaskingOptions {
  preserveLength?: boolean;
  maskChar?: string;
  preserveLast?: number;
  preserveFirst?: number;
}

/**
 * Data masking service for HIPAA compliance
 * @internal
 */
@Injectable()
export class DataMaskingService {
  private readonly serviceName = 'DataMaskingService';
  private readonly enabled: boolean;
  private readonly maskChar = '*';
  private readonly preserveLast = 4; // Preserve last 4 characters
  private readonly preserveFirst = 0; // Don't preserve first characters by default

  // PHI patterns to detect
  private readonly phiPatterns = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    dateOfBirth: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  };

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.enabled = this.configService.get<boolean>('database.dataMasking.enabled') ?? true;
  }

  /**
   * Mask sensitive data in string
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  maskData(data: string, options?: MaskingOptions): string {
    if (!this.enabled || !data) {
      return data;
    }

    const preserveLast = options?.preserveLast ?? this.preserveLast;
    const preserveFirst = options?.preserveFirst ?? this.preserveFirst;
    const maskChar = options?.maskChar ?? this.maskChar;
    const preserveLength = options?.preserveLength ?? true;

    // Mask PHI patterns
    let masked = data;

    // Mask emails
    masked = masked.replace(this.phiPatterns.email, match => {
      const parts = match.split('@');
      if (parts.length !== 2) {
        return this.maskString(match, { preserveLast, preserveFirst, maskChar, preserveLength });
      }
      const [local, domain] = parts;
      if (!local || !domain) {
        return this.maskString(match, { preserveLast, preserveFirst, maskChar, preserveLength });
      }
      const maskedLocal = this.maskString(local, {
        preserveLast: 0,
        preserveFirst: 1,
        maskChar,
        preserveLength,
      });
      return `${maskedLocal}@${domain}`;
    });

    // Mask phone numbers
    masked = masked.replace(this.phiPatterns.phone, match =>
      this.maskString(match, { preserveLast, preserveFirst: 0, maskChar, preserveLength })
    );

    // Mask SSN
    masked = masked.replace(this.phiPatterns.ssn, match =>
      this.maskString(match, { preserveLast: 4, preserveFirst: 0, maskChar, preserveLength: false })
    );

    // Mask credit cards
    masked = masked.replace(this.phiPatterns.creditCard, match =>
      this.maskString(match, { preserveLast: 4, preserveFirst: 0, maskChar, preserveLength: false })
    );

    return masked;
  }

  /**
   * Mask object properties containing PHI
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  maskObject<T extends Record<string, unknown>>(
    obj: T,
    phiFields: string[] = [
      'email',
      'phone',
      'ssn',
      'dateOfBirth',
      'address',
      'firstName',
      'lastName',
    ]
  ): Partial<T> {
    if (!this.enabled || !obj) {
      return obj;
    }

    const masked = { ...obj };

    for (const field of phiFields) {
      if (field in masked && typeof masked[field] === 'string') {
        (masked as Record<string, unknown>)[field] = this.maskData(masked[field]);
      }
    }

    return masked;
  }

  /**
   * Check if data contains PHI
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  containsPHI(data: string): boolean {
    if (!data) {
      return false;
    }

    for (const pattern of Object.values(this.phiPatterns)) {
      if (pattern.test(data)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Mask string with options
   */
  private maskString(str: string, options: Required<MaskingOptions>): string {
    const { preserveLast, preserveFirst, maskChar, preserveLength } = options;

    if (str.length <= preserveFirst + preserveLast) {
      return maskChar.repeat(str.length);
    }

    const first = preserveFirst > 0 ? str.substring(0, preserveFirst) : '';
    const last = preserveLast > 0 ? str.substring(str.length - preserveLast) : '';
    const middle = str.substring(preserveFirst, str.length - preserveLast);

    const maskedMiddle = preserveLength
      ? maskChar.repeat(middle.length)
      : maskChar.repeat(Math.min(middle.length, 8)); // Max 8 mask chars if not preserving length

    return `${first}${maskedMiddle}${last}`;
  }
}
