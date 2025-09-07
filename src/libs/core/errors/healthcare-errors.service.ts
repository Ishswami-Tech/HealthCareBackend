import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';
import { ErrorMessages } from './error-messages.constant';
import { HealthcareError } from './healthcare-error.class';

/**
 * Centralized Healthcare Error Service
 * Handles all error creation, logging, and management for the healthcare application
 */
@Injectable()
export class HealthcareErrorsService {
  private readonly logger = new Logger(HealthcareErrorsService.name);

  // Authentication & Authorization Errors
  invalidCredentials(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
      context
    );
  }

  tokenExpired(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_TOKEN_EXPIRED,
      HttpStatus.UNAUTHORIZED,
      context
    );
  }

  insufficientPermissions(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
      HttpStatus.FORBIDDEN,
      context
    );
  }

  accountLocked(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_ACCOUNT_LOCKED,
      HttpStatus.FORBIDDEN,
      context
    );
  }

  otpInvalid(context?: string): HealthcareError {
    return this.createError(
      ErrorCode.AUTH_OTP_INVALID,
      HttpStatus.BAD_REQUEST,
      context
    );
  }

  // User Management Errors
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
    return this.createError(
      ErrorCode.USER_EMAIL_ALREADY_EXISTS,
      HttpStatus.CONFLICT,
      context,
      { email }
    );
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
    return this.createError(
      ErrorCode.APPOINTMENT_PAST_DATE,
      HttpStatus.BAD_REQUEST,
      context
    );
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
  validationError(field: string, message?: string, context?: string): HealthcareError {
    return this.createError(
      ErrorCode.VALIDATION_REQUIRED_FIELD,
      HttpStatus.BAD_REQUEST,
      context,
      { field },
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
    return this.createError(
      ErrorCode.SMS_SERVICE_FAILED,
      HttpStatus.SERVICE_UNAVAILABLE,
      context
    );
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
    
    if (this.isCriticalError(error)) {
      this.logger.error(
        `[CRITICAL] ${error.code} in ${errorContext}: ${(error as Error).message}`,
        error.toJSON()
      );
    } else if (this.isWarningError(error)) {
      this.logger.warn(
        `[WARNING] ${error.code} in ${errorContext}: ${(error as Error).message}`,
        error.toJSON()
      );
    } else {
      this.logger.log(
        `[INFO] ${error.code} in ${errorContext}: ${(error as Error).message}`,
        error.toJSON()
      );
    }
  }

  handleGenericError(error: Error, context?: string): void {
    const healthcareError = this.internalServerError(context);
    this.handleError(healthcareError, context);
  }

  // Private helper methods
  private createError(
    code: ErrorCode,
    statusCode: HttpStatus,
    context?: string,
    metadata?: Record<string, any>,
    customMessage?: string
  ): HealthcareError {
    return new HealthcareError(code, customMessage, statusCode, metadata, context);
  }

  private isCriticalError(error: HealthcareError): boolean {
    const criticalCodes = [
      ErrorCode.INTERNAL_SERVER_ERROR,
      ErrorCode.DATABASE_CONNECTION_FAILED,
      ErrorCode.HIPAA_VIOLATION,
      ErrorCode.SECURITY_VIOLATION,
      ErrorCode.SUSPICIOUS_ACTIVITY,
      ErrorCode.PHI_ACCESS_UNAUTHORIZED,
    ];

    return criticalCodes.includes(error.code) || error.statusCode >= 500;
  }

  private isWarningError(error: HealthcareError): boolean {
    const warningCodes = [
      ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      ErrorCode.DATABASE_QUERY_FAILED,
      ErrorCode.EMAIL_SERVICE_FAILED,
      ErrorCode.SMS_SERVICE_FAILED,
      ErrorCode.WHATSAPP_SERVICE_FAILED,
    ];

    return warningCodes.includes(error.code) || 
           (error.statusCode >= 400 && error.statusCode < 500);
  }
}
