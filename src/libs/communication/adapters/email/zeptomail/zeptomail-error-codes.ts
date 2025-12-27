/**
 * ZeptoMail API Error Codes
 * ==========================
 * Comprehensive error code handling for ZeptoMail API
 * @see https://www.zoho.com/zeptomail/help/api-error-codes.html
 *
 * @module ZeptoMailErrorCodes
 * @description ZeptoMail error code definitions and handling
 */

/**
 * ZeptoMail API Error Codes
 * Based on official ZeptoMail documentation
 */
export enum ZeptoMailErrorCode {
  // Authentication Errors
  INVALID_API_KEY = 'INVALID_API_KEY',
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Validation Errors
  INVALID_EMAIL_ADDRESS = 'INVALID_EMAIL_ADDRESS',
  INVALID_FROM_ADDRESS = 'INVALID_FROM_ADDRESS',
  INVALID_SUBJECT = 'INVALID_SUBJECT',
  INVALID_ATTACHMENT = 'INVALID_ATTACHMENT',
  EMAIL_SIZE_EXCEEDED = 'EMAIL_SIZE_EXCEEDED',
  ATTACHMENT_SIZE_EXCEEDED = 'ATTACHMENT_SIZE_EXCEEDED',

  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // Suppression List
  EMAIL_SUPPRESSED = 'EMAIL_SUPPRESSED',
  DOMAIN_SUPPRESSED = 'DOMAIN_SUPPRESSED',

  // Template Errors
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  INVALID_TEMPLATE_DATA = 'INVALID_TEMPLATE_DATA',

  // File Cache Errors
  FILE_CACHE_UPLOAD_FAILED = 'FILE_CACHE_UPLOAD_FAILED',
  FILE_CACHE_KEY_INVALID = 'FILE_CACHE_KEY_INVALID',

  // Server Errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',

  // Unknown
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Error code to user-friendly message mapping
 */
export const ZeptoMailErrorMessages: Record<string, string> = {
  [ZeptoMailErrorCode.INVALID_API_KEY]: 'Invalid ZeptoMail API key. Please check your credentials.',
  [ZeptoMailErrorCode.UNAUTHORIZED]: 'Unauthorized access. Please verify your API token.',
  [ZeptoMailErrorCode.TOKEN_EXPIRED]: 'API token has expired. Please regenerate your token.',
  [ZeptoMailErrorCode.INVALID_EMAIL_ADDRESS]:
    'Invalid email address format. Please check recipient email addresses.',
  [ZeptoMailErrorCode.INVALID_FROM_ADDRESS]:
    'Invalid sender email address. Please verify your from email is authorized.',
  [ZeptoMailErrorCode.INVALID_SUBJECT]: 'Email subject is invalid or too long.',
  [ZeptoMailErrorCode.INVALID_ATTACHMENT]: 'Invalid attachment format or size.',
  [ZeptoMailErrorCode.EMAIL_SIZE_EXCEEDED]:
    'Email size exceeds 15 MB limit. Please reduce email size or use file cache for attachments.',
  [ZeptoMailErrorCode.ATTACHMENT_SIZE_EXCEEDED]:
    'Attachment size exceeds limit. Please use file cache API for large attachments.',
  [ZeptoMailErrorCode.RATE_LIMIT_EXCEEDED]:
    'Rate limit exceeded. Please wait before sending more emails.',
  [ZeptoMailErrorCode.QUOTA_EXCEEDED]: 'Email quota exceeded. Please upgrade your plan.',
  [ZeptoMailErrorCode.EMAIL_SUPPRESSED]:
    'Email address is in suppression list and cannot receive emails.',
  [ZeptoMailErrorCode.DOMAIN_SUPPRESSED]: 'Email domain is suppressed and cannot receive emails.',
  [ZeptoMailErrorCode.TEMPLATE_NOT_FOUND]: 'Email template not found. Please verify template key.',
  [ZeptoMailErrorCode.INVALID_TEMPLATE_DATA]:
    'Invalid template data. Please check template variable values.',
  [ZeptoMailErrorCode.FILE_CACHE_UPLOAD_FAILED]: 'Failed to upload file to ZeptoMail file cache.',
  [ZeptoMailErrorCode.FILE_CACHE_KEY_INVALID]: 'Invalid file cache key.',
  [ZeptoMailErrorCode.INTERNAL_ERROR]:
    'ZeptoMail internal error. Please try again later or contact support.',
  [ZeptoMailErrorCode.SERVICE_UNAVAILABLE]:
    'ZeptoMail service is temporarily unavailable. Please try again later.',
  [ZeptoMailErrorCode.TIMEOUT]: 'Request timeout. Please try again.',
  [ZeptoMailErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred. Please contact support.',
};

/**
 * Check if error is retryable
 */
export function isZeptoMailErrorRetryable(errorCode: string): boolean {
  const retryableCodes = [
    ZeptoMailErrorCode.INTERNAL_ERROR,
    ZeptoMailErrorCode.SERVICE_UNAVAILABLE,
    ZeptoMailErrorCode.TIMEOUT,
    ZeptoMailErrorCode.RATE_LIMIT_EXCEEDED,
  ];

  return retryableCodes.includes(errorCode as ZeptoMailErrorCode);
}

/**
 * Get user-friendly error message
 */
export function getZeptoMailErrorMessage(errorCode: string): string {
  const message = ZeptoMailErrorMessages[errorCode];
  if (message) {
    return message;
  }
  return ZeptoMailErrorMessages[ZeptoMailErrorCode.UNKNOWN_ERROR] || 'An unknown error occurred.';
}
