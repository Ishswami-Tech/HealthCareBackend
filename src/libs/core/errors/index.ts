/**
 * Centralized Healthcare Error System
 * Simple, robust error handling for healthcare applications
 */

// Core error classes and types
export { HealthcareError } from './healthcare-error.class';
export { ErrorCode } from './error-codes.enum';
export { ErrorMessages } from './error-messages.constant';

// Main error service
export { HealthcareErrorsService } from './healthcare-errors.service';

// Re-export for convenience
export { HealthcareErrorsService as Errors } from './healthcare-errors.service';
