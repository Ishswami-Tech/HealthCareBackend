import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from "@nestjs/common";
import { validate } from "class-validator";
import { plainToClass } from "class-transformer";

/**
 * Type constructor for validation pipe
 * @template T - The type to construct
 */
type Constructor<T = object> = new (...args: unknown[]) => T;

/**
 * Validation result interface
 */
interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Enhanced Validation Pipe
 *
 * Provides comprehensive validation for incoming request data using class-validator.
 * Supports strict type checking and detailed error reporting for healthcare applications.
 *
 * @class ValidationPipe
 * @implements {PipeTransform<object>}
 * @description Advanced validation pipe with healthcare-specific error handling
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Post()
 *   @UsePipes(ValidationPipe)
 *   async createAppointment(@Body() dto: CreateAppointmentDto) {
 *     // dto is automatically validated
 *   }
 * }
 * ```
 */
@Injectable()
export class ValidationPipe implements PipeTransform<object> {
  /**
   * Transform and validate incoming data
   *
   * @param {object} value - The incoming data to validate
   * @param {ArgumentMetadata} metadata - Metadata about the argument
   * @returns {Promise<object>} The validated data
   * @throws {BadRequestException} When validation fails
   *
   * @example
   * ```typescript
   * const result = await validationPipe.transform(userData, { metatype: UserDto });
   * ```
   */
  async transform(
    value: object,
    { metatype }: ArgumentMetadata,
  ): Promise<object> {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    try {
      // Convert plain object to class instance for validation
      const object = plainToClass(metatype, value as Record<string, unknown>);

      // Validate the object
      const errors = await validate(object);

      if (errors.length > 0) {
        const validationResult = this.formatValidationErrors(errors);
        throw new BadRequestException(validationResult);
      }

      return value;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle unexpected validation errors
      throw new BadRequestException({
        message: "Validation failed due to unexpected error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if the metatype should be validated
   *
   * @param {Constructor} metatype - The constructor to check
   * @returns {boolean} True if the type should be validated
   *
   * @private
   */
  private toValidate(metatype: Constructor): boolean {
    const types: readonly Constructor[] = [
      String,
      Boolean,
      Number,
      Array,
      Object,
    ];
    return !types.includes(metatype);
  }

  /**
   * Format validation errors for better error reporting
   *
   * @param {unknown[]} errors - Raw validation errors from class-validator
   * @returns {ValidationResult} Formatted validation result
   *
   * @private
   */
  private formatValidationErrors(errors: unknown[]): ValidationResult {
    const formattedErrors: string[] = [];

    for (const error of errors) {
      if (this.isValidationError(error)) {
        const constraints = error.constraints;
        if (constraints) {
          for (const message of Object.values(constraints)) {
            formattedErrors.push(message);
          }
        }
      }
    }

    return {
      isValid: false,
      errors: formattedErrors,
    };
  }

  /**
   * Type guard to check if an error is a validation error
   *
   * @param {unknown} error - The error to check
   * @returns {boolean} True if it's a validation error
   *
   * @private
   */
  private isValidationError(error: unknown): error is {
    readonly constraints?: Record<string, string>;
    readonly property?: string;
  } {
    return (
      typeof error === "object" && error !== null && "constraints" in error
    );
  }
}
