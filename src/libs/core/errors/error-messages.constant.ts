import { ErrorCode } from '@core/errors/error-codes.enum';

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
    'Invalid email or password. Please check your credentials and try again.',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Your session has expired. Please log in again.',
  [ErrorCode.AUTH_TOKEN_INVALID]: 'Invalid authentication token. Please log in again.',
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]:
    'You do not have sufficient permissions to perform this action.',
  [ErrorCode.AUTH_ACCOUNT_LOCKED]:
    'Your account has been temporarily locked due to multiple failed login attempts.',
  [ErrorCode.AUTH_ACCOUNT_DISABLED]:
    'Your account has been disabled. Please contact support for assistance.',
  [ErrorCode.AUTH_OTP_INVALID]: 'Invalid verification code. Please check and try again.',
  [ErrorCode.AUTH_OTP_EXPIRED]: 'Verification code has expired. Please request a new one.',
  [ErrorCode.AUTH_SESSION_EXPIRED]: 'Your session has expired. Please log in again.',

  // User Management Errors
  [ErrorCode.USER_NOT_FOUND]: 'User not found. Please check the user ID and try again.',
  [ErrorCode.USER_ALREADY_EXISTS]: 'A user with this information already exists.',
  [ErrorCode.USER_EMAIL_ALREADY_EXISTS]: 'An account with this email address already exists.',
  [ErrorCode.USER_PHONE_ALREADY_EXISTS]: 'An account with this phone number already exists.',
  [ErrorCode.USER_PROFILE_INCOMPLETE]:
    'Please complete your profile information before proceeding.',
  [ErrorCode.USER_ROLE_INVALID]: 'Invalid user role specified.',

  // Clinic Management Errors
  [ErrorCode.CLINIC_NOT_FOUND]: 'Clinic not found. Please check the clinic ID and try again.',
  [ErrorCode.CLINIC_ALREADY_EXISTS]: 'A clinic with this information already exists.',
  [ErrorCode.CLINIC_ACCESS_DENIED]: 'You do not have access to this clinic.',
  [ErrorCode.CLINIC_LICENSE_EXPIRED]: 'Clinic license has expired. Please renew your license.',
  [ErrorCode.CLINIC_QUOTA_EXCEEDED]:
    'Clinic has exceeded its user quota. Please upgrade your plan.',
  [ErrorCode.CLINIC_ID_REQUIRED]:
    'Clinic ID is required but was not provided. Ensure CLINIC_ID is configured or passed in the request context.',

  // IPD / Bed Management Errors
  [ErrorCode.IPD_BED_NOT_FOUND]: 'Bed not found in the specified clinic.',
  [ErrorCode.IPD_BED_NOT_AVAILABLE]: 'Bed is not available. Current status: {{status}}.',
  [ErrorCode.IPD_PATIENT_ALREADY_ADMITTED]:
    'Patient already has an active admission ({{admissionNumber}}). Discharge first.',
  [ErrorCode.IPD_TRANSFER_INVALID_STATUS]:
    'Cannot transfer discharged admission. Current status: {{status}}.',
  [ErrorCode.IPD_TARGET_BED_NOT_FOUND]: 'Target bed not found.',
  [ErrorCode.IPD_BED_WARD_MISMATCH]: 'Bed does not belong to the specified ward.',
  [ErrorCode.IPD_TARGET_BED_NOT_AVAILABLE]:
    'Target bed is not available. Current status: {{status}}.',
  [ErrorCode.IPD_ALREADY_DISCHARGED]: 'Patient is already discharged.',
  [ErrorCode.IPD_WARD_ALREADY_EXISTS]: 'Ward "{{wardName}}" already exists in this clinic.',
  [ErrorCode.IPD_WARD_NOT_FOUND]: 'Ward not found. Please check the ward ID.',
  [ErrorCode.IPD_BED_ALREADY_EXISTS]: 'Bed "{{bedNumber}}" already exists in this ward.',
  [ErrorCode.IPD_ADMISSION_NOT_FOUND]: 'Admission not found.',
  [ErrorCode.IPD_BED_OCCUPIED_TRANSFER_REQUIRED]:
    'Cannot set occupied bed to {{status}} directly. {{action}} first.',

  // Pharmacy Inventory Errors
  [ErrorCode.PHARMACY_BATCH_NOT_FOUND]: 'Batch not found in the specified clinic.',
  [ErrorCode.PHARMACY_LOT_NUMBER_DUPLICATE]:
    'Batch with this lot number already exists for this product in this clinic.',
  [ErrorCode.PHARMACY_EXPIRY_DATE_INVALID]: 'Expiry date must be in the future.',
  [ErrorCode.PHARMACY_MANUFACTURE_DATE_INVALID]: 'Manufacture date cannot be in the future.',

  // Appointment Errors
  [ErrorCode.APPOINTMENT_NOT_FOUND]:
    'Appointment not found. Please check the appointment ID and try again.',
  [ErrorCode.APPOINTMENT_ALREADY_EXISTS]: 'An appointment already exists for this time slot.',
  [ErrorCode.APPOINTMENT_CONFLICT]: 'This appointment conflicts with an existing appointment.',
  [ErrorCode.APPOINTMENT_CANNOT_CANCEL]: 'This appointment cannot be cancelled at this time.',
  [ErrorCode.APPOINTMENT_CANNOT_RESCHEDULE]: 'This appointment cannot be rescheduled at this time.',
  [ErrorCode.APPOINTMENT_SLOT_UNAVAILABLE]: 'The selected time slot is no longer available.',
  [ErrorCode.APPOINTMENT_PAST_DATE]: 'Cannot schedule appointments for past dates.',

  // Check-In Errors
  [ErrorCode.CHECKIN_NO_APPOINTMENT_FOUND]:
    'No appointment found for this location. Please ensure you have a scheduled appointment.',
  [ErrorCode.CHECKIN_ALREADY_CONFIRMED]:
    'Your clinic arrival is already confirmed for this appointment. Please wait for your turn.',
  [ErrorCode.CHECKIN_WRONG_LOCATION]:
    'This appointment is scheduled for a different location. Please go to the correct location.',
  [ErrorCode.CHECKIN_APPOINTMENT_EXPIRED]:
    'This appointment has expired. Please contact the clinic to reschedule.',
  [ErrorCode.CHECKIN_TIME_WINDOW_EXPIRED]:
    'Check-in window has expired. Please check in within 30 minutes before or 3 hours after your appointment time.',
  [ErrorCode.CHECKIN_INVALID_QR_CODE]:
    'Invalid QR code. Please scan the correct QR code for this location.',

  // Doctor & Staff Errors
  [ErrorCode.DOCTOR_NOT_FOUND]: 'Doctor not found. Please check the doctor ID and try again.',
  [ErrorCode.DOCTOR_UNAVAILABLE]: 'Doctor is not available for the selected time.',
  [ErrorCode.DOCTOR_ALREADY_ASSIGNED]: 'Doctor is already assigned to another appointment.',
  [ErrorCode.STAFF_NOT_FOUND]: 'Staff member not found. Please check the staff ID and try again.',
  [ErrorCode.STAFF_UNAUTHORIZED]: 'Staff member is not authorized to perform this action.',

  // Patient Errors
  [ErrorCode.PATIENT_NOT_FOUND]: 'Patient not found. Please check the patient ID and try again.',
  [ErrorCode.PATIENT_ALREADY_EXISTS]: 'A patient with this information already exists.',
  [ErrorCode.PATIENT_RECORD_LOCKED]: 'Patient record is currently locked by another user.',
  [ErrorCode.PATIENT_CONSENT_REQUIRED]: 'Patient consent is required to access this information.',

  // Validation Errors
  [ErrorCode.VALIDATION_ERROR]: 'The request contains invalid data. Please review the input.',
  [ErrorCode.VALIDATION_REQUIRED_FIELD]: 'This field is required and cannot be empty.',
  [ErrorCode.VALIDATION_INVALID_FORMAT]: 'Invalid format. Please check the input and try again.',
  [ErrorCode.VALIDATION_INVALID_EMAIL]: 'Please enter a valid email address.',
  [ErrorCode.VALIDATION_INVALID_PHONE]: 'Please enter a valid phone number.',
  [ErrorCode.VALIDATION_INVALID_DATE]: 'Please enter a valid date.',
  [ErrorCode.VALIDATION_INVALID_TIME]: 'Please enter a valid time.',
  [ErrorCode.VALIDATION_INVALID_UUID]: 'Invalid ID format.',
  [ErrorCode.VALIDATION_STRING_TOO_LONG]: 'Text is too long. Please shorten it.',
  [ErrorCode.VALIDATION_STRING_TOO_SHORT]: 'Text is too short. Please provide more information.',
  [ErrorCode.VALIDATION_NUMBER_OUT_OF_RANGE]: 'Number is outside the allowed range.',

  // Database Errors
  [ErrorCode.DATABASE_CONNECTION_FAILED]: 'Database connection failed. Please try again later.',
  [ErrorCode.DATABASE_QUERY_FAILED]: 'Database query failed. Please try again.',
  [ErrorCode.DATABASE_QUERY_TIMEOUT]:
    'Database query timed out. The operation took too long to complete.',
  [ErrorCode.DATABASE_TRANSACTION_FAILED]: 'Database transaction failed. Please try again.',
  [ErrorCode.DATABASE_CONSTRAINT_VIOLATION]: 'Data constraint violation. Please check your input.',
  [ErrorCode.DATABASE_RECORD_NOT_FOUND]: 'Record not found in database.',
  [ErrorCode.DATABASE_DUPLICATE_ENTRY]: 'Duplicate entry found. This record already exists.',

  // External Service Errors
  [ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE]:
    'External service is currently unavailable. Please try again later.',
  [ErrorCode.EXTERNAL_SERVICE_TIMEOUT]: 'External service request timed out. Please try again.',
  [ErrorCode.EXTERNAL_SERVICE_INVALID_RESPONSE]: 'Invalid response from external service.',
  [ErrorCode.EMAIL_SERVICE_FAILED]: 'Failed to send email. Please try again later.',
  [ErrorCode.SMS_SERVICE_FAILED]: 'Failed to send SMS. Please try again later.',
  [ErrorCode.WHATSAPP_SERVICE_FAILED]: 'Failed to send WhatsApp message. Please try again later.',
  [ErrorCode.PAYMENT_SERVICE_FAILED]: 'Payment processing failed. Please try again.',

  // File & Media Errors
  [ErrorCode.FILE_NOT_FOUND]: 'File not found. Please check the file path.',
  [ErrorCode.FILE_TOO_LARGE]: 'File is too large. Please choose a smaller file.',
  [ErrorCode.FILE_INVALID_FORMAT]: 'Invalid file format. Please choose a supported file type.',
  [ErrorCode.FILE_UPLOAD_FAILED]: 'File upload failed. Please try again.',
  [ErrorCode.FILE_DOWNLOAD_FAILED]: 'File download failed. Please try again.',
  [ErrorCode.FILE_DELETE_FAILED]: 'File deletion failed. Please try again.',

  // Rate Limiting & Security
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please wait before trying again.',
  [ErrorCode.SECURITY_VIOLATION]: 'Security violation detected. Access denied.',
  [ErrorCode.SUSPICIOUS_ACTIVITY]: 'Suspicious activity detected. Please contact support.',
  [ErrorCode.IP_BLOCKED]: 'Your IP address has been blocked. Please contact support.',

  // Business Logic Errors
  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'This action violates business rules.',
  [ErrorCode.WORKFLOW_STATE_INVALID]: 'Invalid workflow state. Cannot perform this action.',
  [ErrorCode.OPERATION_NOT_ALLOWED]: 'This operation is not allowed in the current context.',
  [ErrorCode.RESOURCE_LOCKED]: 'Resource is currently locked by another user.',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'Requested resource was not found.',
  [ErrorCode.QUOTA_EXCEEDED]: 'You have exceeded your quota limit.',

  // System Errors
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'An internal server error occurred. Please try again later.',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service is temporarily unavailable. Please try again later.',
  [ErrorCode.CONFIGURATION_ERROR]: 'System configuration error. Please contact support.',
  [ErrorCode.FEATURE_NOT_IMPLEMENTED]: 'This feature is not yet implemented.',
  [ErrorCode.MAINTENANCE_MODE]: 'System is under maintenance. Please try again later.',

  // HIPAA & Compliance Errors
  [ErrorCode.HIPAA_VIOLATION]: 'HIPAA compliance violation detected.',
  [ErrorCode.AUDIT_LOG_FAILED]: 'Failed to log audit information.',
  [ErrorCode.DATA_RETENTION_VIOLATION]: 'Data retention policy violation.',
  [ErrorCode.CONSENT_EXPIRED]: 'Patient consent has expired. Please obtain new consent.',
  [ErrorCode.PHI_ACCESS_UNAUTHORIZED]: 'Unauthorized access to Protected Health Information.',
  [ErrorCode.AYURVEDA_INVALID_SAMPRAPTI_STAGE]:
    'Cannot activate stage {{stageOrder}}: a higher-order stage is already active.',
  [ErrorCode.AYURVEDA_INVALID_ASSESSMENT]: 'Invalid assessment data. Please check your input.',
  [ErrorCode.AYURVEDA_PATIENT_REQUIRED]: 'Patient ID is required for assessment.',

  // Logging Errors
  [ErrorCode.CACHE_CONNECTION_FAILED]: 'Cache connection failed. Please try again later.',
  [ErrorCode.CACHE_OPERATION_FAILED]: 'Cache operation failed. Please try again.',
  [ErrorCode.CACHE_KEY_NOT_FOUND]: 'Cache key not found.',
  [ErrorCode.CACHE_INVALIDATION_FAILED]: 'Cache invalidation failed. Please try again.',
  [ErrorCode.CACHE_CONFIGURATION_ERROR]: 'Cache configuration error. Please contact support.',
  [ErrorCode.CACHE_TIMEOUT]: 'Cache operation timed out. Please try again.',
  [ErrorCode.CACHE_SERIALIZATION_ERROR]: 'Cache serialization error. Please try again.',

  // Pharmacy Inventory Errors
  [ErrorCode.PHARMACY_INVENTORY_NOT_FOUND]: 'Pharmacy inventory item not found.',
  [ErrorCode.PHARMACY_STOCK_INSUFFICIENT]: 'Insufficient stock available for this operation.',
  [ErrorCode.PHARMACY_BATCH_EXPIRED]: 'Pharmacy batch has expired.',
  [ErrorCode.PHARMACY_TRANSFER_NOT_FOUND]: 'Pharmacy transfer not found.',
  [ErrorCode.PHARMACY_TRANSFER_INVALID_STATUS]: 'Pharmacy transfer is in an invalid status.',
  [ErrorCode.PHARMACY_TRANSFER_CROSS_CLINIC_DENIED]: 'Cross-clinic pharmacy transfer is denied.',
  [ErrorCode.PHARMACY_PURCHASE_ORDER_NOT_FOUND]: 'Pharmacy purchase order not found.',
  [ErrorCode.PHARMACY_REORDER_RULE_NOT_FOUND]: 'Pharmacy reorder rule not found.',
  [ErrorCode.PHARMACY_ALERT_NOT_FOUND]: 'Pharmacy alert not found.',

  // Event Errors
  [ErrorCode.EVENT_EMISSION_FAILED]: 'Event emission failed. Please try again.',
  [ErrorCode.EVENT_PROCESSING_FAILED]: 'Event processing failed. Please try again.',
  [ErrorCode.EVENT_SUBSCRIPTION_FAILED]: 'Event subscription failed. Please try again.',

  // Queue Errors
  [ErrorCode.QUEUE_INITIALIZATION_FAILED]: 'Queue initialization failed. Please try again later.',
  [ErrorCode.QUEUE_OPERATION_FAILED]: 'Queue operation failed. Please try again.',
  [ErrorCode.QUEUE_JOB_NOT_FOUND]: 'Queue job not found. Please check the job ID.',
  [ErrorCode.QUEUE_NOT_FOUND]: 'Queue not found. Please check the queue name.',
  [ErrorCode.QUEUE_AT_CAPACITY]: 'Queue has reached maximum capacity.',
  [ErrorCode.QUEUE_PATIENT_ALREADY_QUEUED]: 'Patient already has an active entry in this queue.',
  [ErrorCode.QUEUE_INVALID_TRANSITION]: 'Invalid status transition: {{from}} → {{to}}.',
  [ErrorCode.QUEUE_NO_WAITING_PATIENTS]: 'No waiting patients in this queue.',
  [ErrorCode.EVENT_QUERY_FAILED]: 'Event query failed. Please try again.',
  [ErrorCode.EVENT_CIRCUIT_BREAKER_OPEN]: 'Event circuit breaker is open. Please try again later.',

  // Logging Errors
  [ErrorCode.LOGGING_INITIALIZATION_FAILED]:
    'Logging initialization failed. Please contact support.',
  [ErrorCode.LOGGING_OPERATION_FAILED]: 'Logging operation failed. Please try again.',
  [ErrorCode.LOGGING_RETRIEVAL_FAILED]: 'Failed to retrieve log information. Please try again.',
  [ErrorCode.LOGGING_CLEAR_FAILED]: 'Failed to clear logs. Please try again.',
};
