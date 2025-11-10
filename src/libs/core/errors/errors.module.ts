import { Global, Module, forwardRef } from '@nestjs/common';
import { HealthcareErrorsService } from './healthcare-errors.service';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Global Errors Module
 * Provides centralized error handling across the entire application
 *
 * @module ErrorsModule
 * @description Global module that makes HealthcareErrorsService available throughout the application
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
  providers: [HealthcareErrorsService],
  exports: [HealthcareErrorsService],
})
export class ErrorsModule {}
