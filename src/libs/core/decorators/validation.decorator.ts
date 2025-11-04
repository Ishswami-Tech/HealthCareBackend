/**
 * Validation decorators for request validation
 *
 * This module provides decorators for enhanced request validation,
 * including custom validation rules and error handling.
 *
 * @module ValidationDecorators
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Validation metadata key
 */
export const VALIDATION_KEY = 'validation' as const;

/**
 * Validation options interface
 */
export interface ValidationOptions {
  /** Whether to skip validation */
  readonly skipValidation?: boolean;
  /** Custom validation groups */
  readonly groups?: readonly string[];
  /** Whether to validate nested objects */
  readonly validateNested?: boolean;
  /** Custom error message */
  readonly errorMessage?: string;
  /** Whether to transform the data before validation */
  readonly transform?: boolean;
  /** Whether to whitelist unknown properties */
  readonly whitelist?: boolean;
  /** Whether to forbid unknown properties */
  readonly forbidUnknownValues?: boolean;
}

/**
 * Validation decorator for custom validation options
 *
 * This decorator allows specifying custom validation options for route handlers.
 * It can be used to override default validation behavior or add additional
 * validation rules.
 *
 * @param options - Validation options
 * @returns Decorator function that sets validation metadata
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UsersController {
 *   @Post()
 *   @Validation({
 *     groups: ['create'],
 *     transform: true,
 *     whitelist: true
 *   })
 *   async createUser(@Body() createUserDto: CreateUserDto) {
 *     return this.usersService.create(createUserDto);
 *   }
 * }
 * ```
 */
export const Validation = (options: ValidationOptions): MethodDecorator =>
  SetMetadata(VALIDATION_KEY, options);

/**
 * Skip validation decorator
 *
 * This decorator marks a route handler to skip validation entirely.
 * Use with caution as it bypasses all validation checks.
 *
 * @returns Decorator function that sets skip validation metadata
 *
 * @example
 * ```typescript
 * @Get('health')
 * @SkipValidation()
 * async healthCheck() {
 *   return { status: 'ok' };
 * }
 * ```
 */
export const SkipValidation = (): MethodDecorator =>
  SetMetadata(VALIDATION_KEY, { skipValidation: true });

/**
 * Transform decorator for data transformation
 *
 * This decorator enables automatic data transformation before validation.
 * Useful for converting string inputs to appropriate types.
 *
 * @returns Decorator function that sets transform metadata
 *
 * @example
 * ```typescript
 * @Post('appointments')
 * @Transform()
 * async createAppointment(@Body() createDto: CreateAppointmentDto) {
 *   // Data will be automatically transformed before validation
 *   return this.appointmentsService.create(createDto);
 * }
 * ```
 */
export const Transform = (): MethodDecorator => SetMetadata(VALIDATION_KEY, { transform: true });

/**
 * Whitelist decorator for property filtering
 *
 * This decorator enables whitelisting of properties, removing any
 * properties that are not defined in the DTO.
 *
 * @returns Decorator function that sets whitelist metadata
 *
 * @example
 * ```typescript
 * @Post('patients')
 * @Whitelist()
 * async createPatient(@Body() createDto: CreatePatientDto) {
 *   // Only properties defined in CreatePatientDto will be kept
 *   return this.patientsService.create(createDto);
 * }
 * ```
 */
export const Whitelist = (): MethodDecorator => SetMetadata(VALIDATION_KEY, { whitelist: true });
