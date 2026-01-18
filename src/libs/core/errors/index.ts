/**
 * Centralized Healthcare Error System
 * Simple, robust error handling for healthcare applications
 *
 * @module HealthcareErrors
 * @description Comprehensive error handling system for healthcare applications
 * @example
 * ```typescript
 * import { HealthcareErrorsService, ErrorCode, HealthcareError } from '@libs/core/errors';
 *
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

// Core error classes and types
export { HealthcareError, ErrorMetadata, ApiErrorResponse } from './healthcare-error.class';
export { ErrorCode } from './error-codes.enum';
export { ErrorMessages } from './error-messages.constant';

// Main error service
export { HealthcareErrorsService } from './healthcare-errors.service';

// Module
export { ErrorsModule } from './errors.module';

// Re-export for convenience
export { HealthcareErrorsService as Errors } from './healthcare-errors.service';

// Cache error handler - NOT exported from barrel to avoid circular dependency
// Import directly: import { CacheErrorHandler } from '@core/errors/cache-error.handler';
// CacheErrorHandler depends on LoggingService, which imports HealthcareError from this barrel
// Exporting it here creates a circular dependency chain

// Database error handler - NOT exported from barrel to avoid circular dependency
// Import directly: import { DatabaseErrorHandler, DatabaseErrorType, ErrorContext } from '@core/errors/database-error.handler';
// DatabaseErrorHandler depends on LoggingService, which imports from this barrel
// Exporting it here creates: errors -> database-error.handler -> logging -> events -> resilience -> framework cycle
