import { Global, Module } from "@nestjs/common";
import { HealthcareErrorsService } from "./healthcare-errors.service";

/**
 * Global Errors Module
 * Provides centralized error handling across the entire application
 *
 * @module ErrorsModule
 * @description Global module that makes HealthcareErrorsService available throughout the application
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
  providers: [HealthcareErrorsService],
  exports: [HealthcareErrorsService],
})
export class ErrorsModule {}
