import { ErrorCode } from "./error-codes.enum";

/**
 * Centralized error messages for the healthcare application
 * Each message provides clear, user-friendly descriptions
 *
 * @constant {Record<ErrorCode, string>} ErrorMessages
 * @description Maps error codes to human-readable messages
 * @example
 * ```typescript
 * const message = ErrorMessages[ErrorCode.USER_NOT_FOUND];
 * // Returns: "User not found. Please check the user ID and try again."
 * ```
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // Authentication & Authorization Errors
  [ErrorCode.AUTH_INVALID_CREDENTIALS]:
    "Invalid email or password. Please check your credentials and try again.",
  [ErrorCode.AUTH_TOKEN_EXPIRED]:
    "Your session has expired. Please log in again.",
  [ErrorCode.AUTH_TOKEN_INVALID]:
    "Invalid authentication token. Please log in again.",
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]:
    "You do not have sufficient permissions to perform this action.",
  [ErrorCode.AUTH_ACCOUNT_LOCKED]:
    "Your account has been temporarily locked due to multiple failed login attempts.",
  [ErrorCode.AUTH_ACCOUNT_DISABLED]:
    "Your account has been disabled. Please contact support for assistance.",
  [ErrorCode.AUTH_OTP_INVALID]:
    "Invalid verification code. Please check and try again.",
  [ErrorCode.AUTH_OTP_EXPIRED]:
    "Verification code has expired. Please request a new one.",
  [ErrorCode.AUTH_SESSION_EXPIRED]:
    "Your session has expired. Please log in again.",

  // User Management Errors
  [ErrorCode.USER_NOT_FOUND]:
    "User not found. Please check the user ID and try again.",
  [ErrorCode.USER_ALREADY_EXISTS]:
    "A user with this information already exists.",
  [ErrorCode.USER_EMAIL_ALREADY_EXISTS]:
    "An account with this email address already exists.",
  [ErrorCode.USER_PHONE_ALREADY_EXISTS]:
    "An account with this phone number already exists.",
  [ErrorCode.USER_PROFILE_INCOMPLETE]:
    "Please complete your profile information before proceeding.",
  [ErrorCode.USER_ROLE_INVALID]: "Invalid user role specified.",

  // Clinic Management Errors
  [ErrorCode.CLINIC_NOT_FOUND]:
    "Clinic not found. Please check the clinic ID and try again.",
  [ErrorCode.CLINIC_ALREADY_EXISTS]:
    "A clinic with this information already exists.",
  [ErrorCode.CLINIC_ACCESS_DENIED]: "You do not have access to this clinic.",
  [ErrorCode.CLINIC_LICENSE_EXPIRED]:
    "Clinic license has expired. Please renew your license.",
  [ErrorCode.CLINIC_QUOTA_EXCEEDED]:
    "Clinic has exceeded its user quota. Please upgrade your plan.",

  // Appointment Errors
  [ErrorCode.APPOINTMENT_NOT_FOUND]:
    "Appointment not found. Please check the appointment ID and try again.",
  [ErrorCode.APPOINTMENT_ALREADY_EXISTS]:
    "An appointment already exists for this time slot.",
  [ErrorCode.APPOINTMENT_CONFLICT]:
    "This appointment conflicts with an existing appointment.",
  [ErrorCode.APPOINTMENT_CANNOT_CANCEL]:
    "This appointment cannot be cancelled at this time.",
  [ErrorCode.APPOINTMENT_CANNOT_RESCHEDULE]:
    "This appointment cannot be rescheduled at this time.",
  [ErrorCode.APPOINTMENT_SLOT_UNAVAILABLE]:
    "The selected time slot is no longer available.",
  [ErrorCode.APPOINTMENT_PAST_DATE]:
    "Cannot schedule appointments for past dates.",

  // Doctor & Staff Errors
  [ErrorCode.DOCTOR_NOT_FOUND]:
    "Doctor not found. Please check the doctor ID and try again.",
  [ErrorCode.DOCTOR_UNAVAILABLE]:
    "Doctor is not available for the selected time.",
  [ErrorCode.DOCTOR_ALREADY_ASSIGNED]:
    "Doctor is already assigned to another appointment.",
  [ErrorCode.STAFF_NOT_FOUND]:
    "Staff member not found. Please check the staff ID and try again.",
  [ErrorCode.STAFF_UNAUTHORIZED]:
    "Staff member is not authorized to perform this action.",

  // Patient Errors
  [ErrorCode.PATIENT_NOT_FOUND]:
    "Patient not found. Please check the patient ID and try again.",
  [ErrorCode.PATIENT_ALREADY_EXISTS]:
    "A patient with this information already exists.",
  [ErrorCode.PATIENT_RECORD_LOCKED]:
    "Patient record is currently locked by another user.",
  [ErrorCode.PATIENT_CONSENT_REQUIRED]:
    "Patient consent is required to access this information.",

  // Validation Errors
  [ErrorCode.VALIDATION_REQUIRED_FIELD]:
    "This field is required and cannot be empty.",
  [ErrorCode.VALIDATION_INVALID_FORMAT]:
    "Invalid format. Please check the input and try again.",
  [ErrorCode.VALIDATION_INVALID_EMAIL]: "Please enter a valid email address.",
  [ErrorCode.VALIDATION_INVALID_PHONE]: "Please enter a valid phone number.",
  [ErrorCode.VALIDATION_INVALID_DATE]: "Please enter a valid date.",
  [ErrorCode.VALIDATION_INVALID_TIME]: "Please enter a valid time.",
  [ErrorCode.VALIDATION_INVALID_UUID]: "Invalid ID format.",
  [ErrorCode.VALIDATION_STRING_TOO_LONG]:
    "Text is too long. Please shorten it.",
  [ErrorCode.VALIDATION_STRING_TOO_SHORT]:
    "Text is too short. Please provide more information.",
  [ErrorCode.VALIDATION_NUMBER_OUT_OF_RANGE]:
    "Number is outside the allowed range.",

  // Database Errors
  [ErrorCode.DATABASE_CONNECTION_FAILED]:
    "Database connection failed. Please try again later.",
  [ErrorCode.DATABASE_QUERY_FAILED]: "Database query failed. Please try again.",
  [ErrorCode.DATABASE_TRANSACTION_FAILED]:
    "Database transaction failed. Please try again.",
  [ErrorCode.DATABASE_CONSTRAINT_VIOLATION]:
    "Data constraint violation. Please check your input.",
  [ErrorCode.DATABASE_RECORD_NOT_FOUND]: "Record not found in database.",
  [ErrorCode.DATABASE_DUPLICATE_ENTRY]:
    "Duplicate entry found. This record already exists.",

  // External Service Errors
  [ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE]:
    "External service is currently unavailable. Please try again later.",
  [ErrorCode.EXTERNAL_SERVICE_TIMEOUT]:
    "External service request timed out. Please try again.",
  [ErrorCode.EXTERNAL_SERVICE_INVALID_RESPONSE]:
    "Invalid response from external service.",
  [ErrorCode.EMAIL_SERVICE_FAILED]:
    "Failed to send email. Please try again later.",
  [ErrorCode.SMS_SERVICE_FAILED]: "Failed to send SMS. Please try again later.",
  [ErrorCode.WHATSAPP_SERVICE_FAILED]:
    "Failed to send WhatsApp message. Please try again later.",
  [ErrorCode.PAYMENT_SERVICE_FAILED]:
    "Payment processing failed. Please try again.",

  // File & Media Errors
  [ErrorCode.FILE_NOT_FOUND]: "File not found. Please check the file path.",
  [ErrorCode.FILE_TOO_LARGE]:
    "File is too large. Please choose a smaller file.",
  [ErrorCode.FILE_INVALID_FORMAT]:
    "Invalid file format. Please choose a supported file type.",
  [ErrorCode.FILE_UPLOAD_FAILED]: "File upload failed. Please try again.",
  [ErrorCode.FILE_DOWNLOAD_FAILED]: "File download failed. Please try again.",
  [ErrorCode.FILE_DELETE_FAILED]: "File deletion failed. Please try again.",

  // Rate Limiting & Security
  [ErrorCode.RATE_LIMIT_EXCEEDED]:
    "Too many requests. Please wait before trying again.",
  [ErrorCode.SECURITY_VIOLATION]: "Security violation detected. Access denied.",
  [ErrorCode.SUSPICIOUS_ACTIVITY]:
    "Suspicious activity detected. Please contact support.",
  [ErrorCode.IP_BLOCKED]:
    "Your IP address has been blocked. Please contact support.",

  // Business Logic Errors
  [ErrorCode.BUSINESS_RULE_VIOLATION]: "This action violates business rules.",
  [ErrorCode.WORKFLOW_STATE_INVALID]:
    "Invalid workflow state. Cannot perform this action.",
  [ErrorCode.OPERATION_NOT_ALLOWED]:
    "This operation is not allowed in the current context.",
  [ErrorCode.RESOURCE_LOCKED]: "Resource is currently locked by another user.",
  [ErrorCode.QUOTA_EXCEEDED]: "You have exceeded your quota limit.",

  // System Errors
  [ErrorCode.INTERNAL_SERVER_ERROR]:
    "An internal server error occurred. Please try again later.",
  [ErrorCode.SERVICE_UNAVAILABLE]:
    "Service is temporarily unavailable. Please try again later.",
  [ErrorCode.CONFIGURATION_ERROR]:
    "System configuration error. Please contact support.",
  [ErrorCode.FEATURE_NOT_IMPLEMENTED]: "This feature is not yet implemented.",
  [ErrorCode.MAINTENANCE_MODE]:
    "System is under maintenance. Please try again later.",

  // HIPAA & Compliance Errors
  [ErrorCode.HIPAA_VIOLATION]: "HIPAA compliance violation detected.",
  [ErrorCode.AUDIT_LOG_FAILED]: "Failed to log audit information.",
  [ErrorCode.DATA_RETENTION_VIOLATION]: "Data retention policy violation.",
  [ErrorCode.CONSENT_EXPIRED]:
    "Patient consent has expired. Please obtain new consent.",
  [ErrorCode.PHI_ACCESS_UNAUTHORIZED]:
    "Unauthorized access to Protected Health Information.",
};
