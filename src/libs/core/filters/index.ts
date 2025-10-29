/**
 * Healthcare Application Exception Filters
 * Comprehensive error handling and filtering for healthcare applications
 *
 * @module HealthcareFilters
 * @description Exception filters for healthcare applications with enhanced logging,
 * security, and error handling capabilities
 * @example
 * ```typescript
 * import { HttpExceptionFilter } from '@libs/core/filters';
 *
 * // app.module.ts
 * import { APP_FILTER } from '@nestjs/core';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_FILTER,
 *       useClass: HttpExceptionFilter,
 *     },
 *   ],
 * })
 * export class AppModule {}
 * ```
 */

// Main exception filter
export { HttpExceptionFilter } from "./http-exception.filter";

// Type definitions
export type {
  RequestUser,
  RequestHeaders,
  CustomFastifyRequest,
  ErrorLog,
  ErrorResponse,
} from "./http-exception.filter";
