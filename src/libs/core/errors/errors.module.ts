import { Global, Module, forwardRef } from '@nestjs/common';
import { HealthcareErrorsService } from './healthcare-errors.service';
import { CacheErrorHandler } from './cache-error.handler';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Global Errors Module
 * Provides centralized error handling across the entire application
 *
 * @module ErrorsModule
 * @description Global module that makes HealthcareErrorsService and CacheErrorHandler available throughout the application
 * Uses forwardRef() to resolve circular dependency with LoggingModule
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [ErrorsModule],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({
  imports: [forwardRef(() => LoggingModule)],
  providers: [HealthcareErrorsService, CacheErrorHandler],
  exports: [HealthcareErrorsService, CacheErrorHandler],
})
export class ErrorsModule {}
