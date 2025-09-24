import { Global, Module } from "@nestjs/common";
import { HealthcareErrorsService } from "./healthcare-errors.service";

/**
 * Global Errors Module
 * Provides centralized error handling across the entire application
 */
@Global()
@Module({
  providers: [HealthcareErrorsService],
  exports: [HealthcareErrorsService],
})
export class ErrorsModule {}
