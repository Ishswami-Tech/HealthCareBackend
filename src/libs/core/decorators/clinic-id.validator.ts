import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Validator constraint for clinic ID format
 * Accepts both UUID v4 format and clinic code format (CL####)
 */
@ValidatorConstraint({ name: 'isClinicId', async: false })
export class IsClinicIdConstraint implements ValidatorConstraintInterface {
  /**
   * Validates clinic ID format
   * @param value - The value to validate
   * @returns true if valid UUID or clinic code format (CL####)
   */
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !value) {
      return false;
    }

    // Check if it's a valid UUID v4
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(value)) {
      return true;
    }

    // Check if it's a valid clinic code format (CL####, e.g., CL0001, CL0002)
    const clinicCodeRegex = /^CL\d{4}$/i;
    if (clinicCodeRegex.test(value)) {
      return true;
    }

    return false;
  }

  /**
   * Default error message
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid UUID or clinic code format (e.g., CL0001, CL0002)`;
  }
}

/**
 * Decorator to validate clinic ID format
 * Accepts both UUID v4 and clinic code format (CL####)
 *
 * @param validationOptions - Optional validation options
 * @returns Property decorator
 *
 * @example
 * ```typescript
 * class MyDto {
 *   @IsClinicId()
 *   clinicId: string; // Accepts: "550e8400-e29b-41d4-a716-446655440000" or "CL0001"
 * }
 * ```
 */
export function IsClinicId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isClinicId',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions ?? {},
      constraints: [],
      validator: IsClinicIdConstraint,
    });
  };
}
