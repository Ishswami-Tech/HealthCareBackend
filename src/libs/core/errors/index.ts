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
