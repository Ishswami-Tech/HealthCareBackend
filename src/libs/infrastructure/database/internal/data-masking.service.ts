/**
 * Data Masking & Anonymization Service
 * @class DataMaskingService
 * @description Masks PHI in non-production environments for security and compliance
 * Preserves referential integrity while protecting sensitive data
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use HealthcareDatabaseClient instead.
 * @internal
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Data Masking Service
 * Masks PHI in non-production environments
 */
@Injectable()
export class DataMaskingService implements OnModuleInit {
  private readonly serviceName = 'DataMaskingService';
  private maskingEnabled = false;
  private readonly environment: string;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.environment = process.env['NODE_ENV'] || 'development';
    this.maskingEnabled =
      this.configService.get<boolean>('DATA_MASKING_ENABLED') ?? this.environment !== 'production';
  }

  onModuleInit(): void {
    if (this.maskingEnabled) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Data masking enabled for environment: ${this.environment}`,
        this.serviceName
      );
    } else {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        'Data masking disabled (production environment)',
        this.serviceName
      );
    }
  }

  /**
   * Mask PHI data based on environment
   * @param data - Data object to mask
   * @param dataType - Type of data being masked
   * @returns Masked data object
   * @internal
   */
  maskPHI<T extends Record<string, unknown>>(
    data: T,
    dataType: 'patient' | 'user' | 'appointment' | 'medical_record' | 'generic' = 'generic'
  ): T {
    if (!this.maskingEnabled || this.environment === 'production') {
      return data;
    }

    try {
      // Create a mutable copy using Record<string, unknown> for mutation
      const masked: Record<string, unknown> = { ...data };

      switch (dataType) {
        case 'patient':
        case 'user':
          return this.maskUserData(masked) as T;
        case 'appointment':
          return this.maskAppointmentData(masked) as T;
        case 'medical_record':
          return this.maskMedicalRecordData(masked) as T;
        default:
          return this.maskGenericData(masked) as T;
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.WARN,
        `Data masking failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName,
        { dataType }
      );
      // Return original data if masking fails
      return data;
    }
  }

  /**
   * Mask user/patient data
   */
  private maskUserData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...data };

    // Mask names
    if (masked['firstName']) {
      masked['firstName'] = this.maskName(masked['firstName'] as string);
    }
    if (masked['lastName']) {
      masked['lastName'] = this.maskName(masked['lastName'] as string);
    }
    if (masked['name']) {
      masked['name'] = this.maskName(masked['name'] as string);
    }

    // Mask email
    if (masked['email']) {
      masked['email'] = this.maskEmail(masked['email'] as string);
    }

    // Mask phone
    if (masked['phone']) {
      masked['phone'] = this.maskPhone(masked['phone'] as string);
    }

    // Mask SSN
    if (masked['ssn'] || masked['socialSecurityNumber']) {
      const ssn = (masked['ssn'] || masked['socialSecurityNumber']) as string;
      masked['ssn'] = this.maskSSN(ssn);
      masked['socialSecurityNumber'] = this.maskSSN(ssn);
    }

    // Mask address
    if (masked['address']) {
      masked['address'] = '[REDACTED]';
    }

    return masked;
  }

  /**
   * Mask appointment data
   */
  private maskAppointmentData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...data };

    // Mask notes/comments
    if (masked['notes']) {
      masked['notes'] = '[REDACTED]';
    }
    if (masked['comments']) {
      masked['comments'] = '[REDACTED]';
    }

    return masked;
  }

  /**
   * Mask medical record data
   */
  private maskMedicalRecordData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...data };

    // Mask diagnosis
    if (masked['diagnosis']) {
      masked['diagnosis'] = '[REDACTED]';
    }

    // Mask notes
    if (masked['notes']) {
      masked['notes'] = '[REDACTED]';
    }

    // Mask report content
    if (masked['report']) {
      masked['report'] = '[REDACTED]';
    }

    return masked;
  }

  /**
   * Mask generic data
   */
  private maskGenericData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...data };

    // Mask common PHI fields
    const phiFields = [
      'firstName',
      'lastName',
      'name',
      'email',
      'phone',
      'ssn',
      'socialSecurityNumber',
      'address',
      'city',
      'state',
      'zipCode',
      'dateOfBirth',
      'emergencyContact',
    ];

    for (const field of phiFields) {
      if (masked[field]) {
        if (field === 'email') {
          masked[field] = this.maskEmail(masked[field] as string);
        } else if (field === 'phone') {
          masked[field] = this.maskPhone(masked[field] as string);
        } else if (field === 'ssn' || field === 'socialSecurityNumber') {
          masked[field] = this.maskSSN(masked[field] as string);
        } else if (field.includes('name') || field === 'emergencyContact') {
          masked[field] = this.maskName(masked[field] as string);
        } else {
          masked[field] = '[REDACTED]';
        }
      }
    }

    return masked;
  }

  /**
   * Mask name (preserve first letter, mask rest)
   */
  private maskName(name: string): string {
    if (!name || name.length === 0) {
      return '[REDACTED]';
    }
    if (name.length === 1) {
      return 'X';
    }
    return name[0] + '*'.repeat(Math.min(name.length - 1, 10));
  }

  /**
   * Mask email (preserve domain, mask username)
   */
  private maskEmail(email: string): string {
    if (!email || !email.includes('@')) {
      return '[REDACTED]@example.com';
    }
    const [username, domain] = email.split('@');
    if (!username || username.length <= 2) {
      return '**@' + domain;
    }
    return username[0] + '***@' + domain;
  }

  /**
   * Mask phone number (preserve last 4 digits)
   */
  private maskPhone(phone: string): string {
    if (!phone) {
      return '[REDACTED]';
    }
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) {
      return '***-****';
    }
    return '***-***-' + digits.slice(-4);
  }

  /**
   * Mask SSN (preserve last 4 digits)
   */
  private maskSSN(ssn: string): string {
    if (!ssn) {
      return '[REDACTED]';
    }
    const digits = ssn.replace(/\D/g, '');
    if (digits.length <= 4) {
      return '***-**-****';
    }
    return '***-**-' + digits.slice(-4);
  }

  /**
   * Check if masking is enabled
   */
  isMaskingEnabled(): boolean {
    return this.maskingEnabled;
  }

  /**
   * Get current environment
   */
  getEnvironment(): string {
    return this.environment;
  }
}
