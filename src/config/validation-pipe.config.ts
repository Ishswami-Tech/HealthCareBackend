import { ValidationPipe, HttpStatus, BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * Validation Pipe Configuration Factory
 *
 * Creates a configured ValidationPipe with healthcare-specific settings
 * including enhanced error logging and formatting.
 *
 * @class ValidationPipeConfig
 * @description Enterprise-grade validation pipe configuration for healthcare applications
 */
export class ValidationPipeConfig {
  /**
   * Get validation pipe options (reusable configuration)
   *
   * @param loggingService - Optional logging service for validation errors
   * @returns ValidationPipeOptions - Configuration options for ValidationPipe
   *
   * @example
   * ```typescript
   * const options = ValidationPipeConfig.getOptions(loggingService);
   * const validationPipe = new ValidationPipe(options);
   * ```
   */
  static getOptions(loggingService?: LoggingService): ValidationPipeOptions {
    const options: ValidationPipeOptions = {
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      exceptionFactory: (errors: ValidationError[]): BadRequestException => {
        const formattedErrors = errors.map(error => ({
          field: error.property,
          constraints: error.constraints,
        }));

        if (loggingService) {
          void loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Validation failed',
            'ValidationPipe',
            { errors: formattedErrors }
          );
        }

        return new BadRequestException({
          type: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: formattedErrors,
        });
      },
    };
    return options;
  }

  /**
   * Create a configured ValidationPipe instance
   *
   * @param loggingService - Optional logging service for validation errors
   * @returns Configured ValidationPipe instance
   *
   * @example
   * ```typescript
   * const validationPipe = ValidationPipeConfig.create(loggingService);
   * app.useGlobalPipes(validationPipe);
   * ```
   */
  static create(loggingService?: LoggingService): ValidationPipe {
    return new ValidationPipe(this.getOptions(loggingService));
  }
}
