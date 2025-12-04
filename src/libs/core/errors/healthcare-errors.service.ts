import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';
import { HealthcareError, ErrorMetadata } from './healthcare-error.class';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Centralized Healthcare Error Service
 * Handles all error creation, logging, and management for the healthcare application
 *
 * @class HealthcareErrorsService
 * @description Service for creating and managing healthcare-specific errors
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(private readonly errors: HealthcareErrorsService) {}
 *
 *   async findUser(userId: string) {
 *     if (!userId) {
 *       throw this.errors.userNotFound(userId, 'UserService.findUser');
 *     }
 *     // ... rest of implementation
 *   }
 * }
 * ```
 */
@Injectable()
export class HealthcareErrorsService {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  // Authentication & Authorization Errors

  /**
   * Creates an error for invalid login credentials
   *
   * @param context - Optional context for debugging
   * @returns HealthcareError with AUTH_INVALID_CREDENTIALS code
   * @example
   * ```typescript
   * if (!isValidCredentials(email, password)) {
   *   throw this.errors.invalidCredentials('AuthService.login');
   * }
   * ```
   */
  invalidCredentials(context?: string): HealthcareError {
    return this.createError(ErrorCode.AUTH_INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, context);
  }

  /**
   * Creates an error for expired authentication token
   *
   * @param context - Optional context for debugging
   * @returns HealthcareError with AUTH_TOKEN_EXPIRED code
   * @example
   * ```typescript
   * if (token.isExpired()) {
   *   throw this.errors.tokenExpired('AuthGuard.validateToken');
   * }
   * ```
   */
  tokenExpired(context?: string): HealthcareError {
    return this.createError(ErrorCode.AUTH_TOKEN_EXPIRED, HttpStatus.UNAUTHORIZED, context);
  }

  /**
   * Creates an error for insufficient user permissions
   *
   * @param context - Optional context for debugging
   * @returns HealthcareError with AUTH_INSUFFICIENT_PERMISSIONS code
   * @example
   * ```typescript
   * if (!user.hasPermission('appointments:write')) {
   *   throw this.errors.insufficientPermissions('AppointmentController.create');
   * }
   * ```
   */
  insufficientPermissions(context?: string): HealthcareError {
    return this.createError(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, HttpStatus.FORBIDDEN, context);
  }

  accountLocked(context?: string): HealthcareError {
    return this.createError(ErrorCode.AUTH_ACCOUNT_LOCKED, HttpStatus.FORBIDDEN, context);
  }

  otpInvalid(context?: string): HealthcareError {
    return this.createError(ErrorCode.AUTH_OTP_INVALID, HttpStatus.BAD_REQUEST, context);
  }

  /**
   * Creates an error for authentication failure
   *
   * @param message - Error message
   * @param context - Optional context for debugging
   * @param metadata - Optional metadata
   * @returns HealthcareError with AUTH_INVALID_CREDENTIALS code
   */
  authenticationError(
    message: string,
    context?: string,
    metadata?: ErrorMetadata
  ): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
      context,
      metadata ? { message, ...metadata } : { message }
    );
  }

  // User Management Errors

  /**
   * Creates an error for user not found
   *
   * @param userId - Optional user ID for metadata
   * @param context - Optional context for debugging
   * @returns HealthcareError with USER_NOT_FOUND code
   * @example
   * ```typescript
   * const user = await this.userRepository.findById(userId);
   * if (!user) {
   *   throw this.errors.userNotFound(userId, 'UserService.findUser');
   * }
   * ```
   */
  userNotFound(userId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.USER_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      userId ? { userId } : undefined
    );
  }

  userAlreadyExists(email?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.USER_ALREADY_EXISTS,
      HttpStatus.CONFLICT,
      context,
      email ? { email } : undefined
    );
  }

  emailAlreadyExists(email: string, context?: string): HealthcareError {
    return this.createError(ErrorCode.USER_EMAIL_ALREADY_EXISTS, HttpStatus.CONFLICT, context, {
      email,
    });
  }

  // Clinic Management Errors
  clinicNotFound(clinicId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.CLINIC_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      clinicId ? { clinicId } : undefined
    );
  }

  clinicAccessDenied(clinicId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.CLINIC_ACCESS_DENIED,
      HttpStatus.FORBIDDEN,
      context,
      clinicId ? { clinicId } : undefined
    );
  }

  clinicQuotaExceeded(clinicId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.CLINIC_QUOTA_EXCEEDED,
      HttpStatus.FORBIDDEN,
      context,
      clinicId ? { clinicId } : undefined
    );
  }

  // Appointment Errors
  appointmentNotFound(appointmentId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.APPOINTMENT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      appointmentId ? { appointmentId } : undefined
    );
  }

  appointmentConflict(appointmentId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.APPOINTMENT_CONFLICT,
      HttpStatus.CONFLICT,
      context,
      appointmentId ? { appointmentId } : undefined
    );
  }

  appointmentSlotUnavailable(slot?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.APPOINTMENT_SLOT_UNAVAILABLE,
      HttpStatus.CONFLICT,
      context,
      slot ? { slot } : undefined
    );
  }

  appointmentPastDate(context?: string): HealthcareError {
    return this.createError(ErrorCode.APPOINTMENT_PAST_DATE, HttpStatus.BAD_REQUEST, context);
  }

  // Doctor & Staff Errors
  doctorNotFound(doctorId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DOCTOR_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      doctorId ? { doctorId } : undefined
    );
  }

  doctorUnavailable(doctorId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DOCTOR_UNAVAILABLE,
      HttpStatus.CONFLICT,
      context,
      doctorId ? { doctorId } : undefined
    );
  }

  staffNotFound(staffId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.STAFF_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      staffId ? { staffId } : undefined
    );
  }

  // Patient Errors
  patientNotFound(patientId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.PATIENT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      patientId ? { patientId } : undefined
    );
  }

  patientConsentRequired(patientId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.PATIENT_CONSENT_REQUIRED,
      HttpStatus.FORBIDDEN,
      context,
      patientId ? { patientId } : undefined
    );
  }

  // Validation Errors
  validationError(
    field: string,
    message?: string,
    context?: string,
    metadata?: ErrorMetadata
  ): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_REQUIRED_FIELD,
      HttpStatus.BAD_REQUEST,
      context,
      metadata ? { field, ...metadata } : { field },
      message
    );
  }

  invalidEmail(email?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_INVALID_EMAIL,
      HttpStatus.BAD_REQUEST,
      context,
      email ? { email } : undefined
    );
  }

  invalidPhone(phone?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_INVALID_PHONE,
      HttpStatus.BAD_REQUEST,
      context,
      phone ? { phone } : undefined
    );
  }

  invalidDate(date?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_INVALID_DATE,
      HttpStatus.BAD_REQUEST,
      context,
      date ? { date } : undefined
    );
  }

  invalidUuid(id?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_INVALID_UUID,
      HttpStatus.BAD_REQUEST,
      context,
      id ? { id } : undefined
    );
  }

  // Database Errors
  databaseError(operation?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DATABASE_QUERY_FAILED,
      HttpStatus.INTERNAL_SERVER_ERROR,
      context,
      operation ? { operation } : undefined
    );
  }

  recordNotFound(table?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DATABASE_RECORD_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      table ? { table } : undefined
    );
  }

  /**
   * Creates an error for resource not found (generic)
   *
   * @param resource - Resource name (e.g., 'Follow-up plan')
   * @param id - Optional resource ID
   * @param context - Optional context for debugging
   * @returns HealthcareError with DATABASE_RECORD_NOT_FOUND code
   */
  notFound(resource: string, id?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DATABASE_RECORD_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      id ? { resource, id } : { resource }
    );
  }

  /**
   * Creates an error for resource not found (alias for notFound)
   *
   * @param resource - Resource name
   * @param context - Optional context for debugging
   * @param metadata - Optional metadata
   * @returns HealthcareError with DATABASE_RECORD_NOT_FOUND code
   */
  notFoundError(resource: string, context?: string, metadata?: ErrorMetadata): HealthcareError {
    return this.createError(
      ErrorCode.DATABASE_RECORD_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      metadata ? { resource, ...metadata } : { resource }
    );
  }

  duplicateEntry(field?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.DATABASE_DUPLICATE_ENTRY,
      HttpStatus.CONFLICT,
      context,
      field ? { field } : undefined
    );
  }

  // Communication Service Errors
  emailServiceError(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.EMAIL_SERVICE_FAILED,
      HttpStatus.SERVICE_UNAVAILABLE,
      context
    );
  }

  smsServiceError(context?: string): HealthcareError {
    return this.createError(ErrorCode.SMS_SERVICE_FAILED, HttpStatus.SERVICE_UNAVAILABLE, context);
  }

  whatsappServiceError(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.WHATSAPP_SERVICE_FAILED,
      HttpStatus.SERVICE_UNAVAILABLE,
      context
    );
  }

  // File & Media Errors
  fileNotFound(filename?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.FILE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      context,
      filename ? { filename } : undefined
    );
  }

  fileTooLarge(maxSize?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.FILE_TOO_LARGE,
      HttpStatus.PAYLOAD_TOO_LARGE,
      context,
      maxSize ? { maxSize } : undefined
    );
  }

  invalidFileFormat(format?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.FILE_INVALID_FORMAT,
      HttpStatus.BAD_REQUEST,
      context,
      format ? { format } : undefined
    );
  }

  // Rate Limiting & Security
  rateLimitExceeded(limit?: number, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      HttpStatus.TOO_MANY_REQUESTS,
      context,
      limit ? { limit } : undefined
    );
  }

  securityViolation(violation?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.SECURITY_VIOLATION,
      HttpStatus.FORBIDDEN,
      context,
      violation ? { violation } : undefined
    );
  }

  suspiciousActivity(activity?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.SUSPICIOUS_ACTIVITY,
      HttpStatus.FORBIDDEN,
      context,
      activity ? { activity } : undefined
    );
  }

  // Business Logic Errors
  businessRuleViolation(rule?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.BUSINESS_RULE_VIOLATION,
      HttpStatus.BAD_REQUEST,
      context,
      rule ? { rule } : undefined
    );
  }

  operationNotAllowed(operation?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.OPERATION_NOT_ALLOWED,
      HttpStatus.METHOD_NOT_ALLOWED,
      context,
      operation ? { operation } : undefined
    );
  }

  resourceLocked(resource?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.RESOURCE_LOCKED,
      HttpStatus.LOCKED,
      context,
      resource ? { resource } : undefined
    );
  }

  // System Errors
  internalServerError(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      context
    );
  }

  serviceUnavailable(service?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.SERVICE_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      context,
      service ? { service } : undefined
    );
  }

  featureNotImplemented(feature?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.FEATURE_NOT_IMPLEMENTED,
      HttpStatus.NOT_IMPLEMENTED,
      context,
      feature ? { feature } : undefined
    );
  }

  // HIPAA & Compliance Errors
  hipaaViolation(violation?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.HIPAA_VIOLATION,
      HttpStatus.FORBIDDEN,
      context,
      violation ? { violation } : undefined
    );
  }

  phiAccessUnauthorized(patientId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.PHI_ACCESS_UNAUTHORIZED,
      HttpStatus.FORBIDDEN,
      context,
      patientId ? { patientId } : undefined
    );
  }

  consentExpired(patientId?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.CONSENT_EXPIRED,
      HttpStatus.FORBIDDEN,
      context,
      patientId ? { patientId } : undefined
    );
  }

  // Error Handling & Logging
  handleError(error: HealthcareError, context?: string): void {
    const errorContext = context || error.context || 'Unknown';

    const errorData = error.toJSON();
    if (this.isCriticalError(error)) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `[CRITICAL] ${error.code} in ${errorContext}: ${error.message}`,
        'HealthcareErrorsService',
        errorData
      );
    } else if (this.isWarningError(error)) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `[WARNING] ${error.code} in ${errorContext}: ${error.message}`,
        'HealthcareErrorsService',
        errorData
      );
    } else {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.INFO,
        `[INFO] ${error.code} in ${errorContext}: ${error.message}`,
        'HealthcareErrorsService',
        errorData
      );
    }
  }

  handleGenericError(error: Error, context?: string): void {
    const healthcareError = this.internalServerError(context);
    this.handleError(healthcareError, context);
  }

  // Private helper methods

  /**
   * Creates a HealthcareError with the specified parameters
   *
   * @param code - The error code
   * @param statusCode - HTTP status code
   * @param context - Optional context
   * @param metadata - Optional metadata
   * @param customMessage - Optional custom message
   * @returns New HealthcareError instance
   * @private
   */
  private createError(
    code: ErrorCode,
    statusCode: HttpStatus,
    context?: string,
    metadata?: ErrorMetadata,
    customMessage?: string
  ): HealthcareError {
    return new HealthcareError(code, customMessage, statusCode, metadata, context);
  }

  /**
   * Determines if an error is critical and should be logged as ERROR level
   *
   * @param error - The HealthcareError to check
   * @returns True if the error is critical
   * @private
   */
  private isCriticalError(error: HealthcareError): boolean {
    const criticalCodes = [
      ErrorCode.INTERNAL_SERVER_ERROR,
      ErrorCode.DATABASE_CONNECTION_FAILED,
      ErrorCode.HIPAA_VIOLATION,
      ErrorCode.SECURITY_VIOLATION,
      ErrorCode.SUSPICIOUS_ACTIVITY,
      ErrorCode.PHI_ACCESS_UNAUTHORIZED,
    ];

    return (
      criticalCodes.includes(error.code) || error.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  /**
   * Determines if an error is a warning and should be logged as WARN level
   *
   * @param error - The HealthcareError to check
   * @returns True if the error is a warning
   * @private
   */
  private isWarningError(error: HealthcareError): boolean {
    const warningCodes = [
      ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      ErrorCode.DATABASE_QUERY_FAILED,
      ErrorCode.EMAIL_SERVICE_FAILED,
      ErrorCode.SMS_SERVICE_FAILED,
      ErrorCode.WHATSAPP_SERVICE_FAILED,
    ];

    return (
      warningCodes.includes(error.code) ||
      (error.statusCode >= HttpStatus.BAD_REQUEST &&
        error.statusCode < HttpStatus.INTERNAL_SERVER_ERROR)
    );
  }
}
