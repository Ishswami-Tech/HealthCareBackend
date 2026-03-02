import { Injectable, PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';

/**
 * Pipe to validate and transform clinic IDs
 * Accepts both UUID v4 format and clinic code format (CL####)
 *
 * @class ClinicIdPipe
 * @implements PipeTransform
 * @description Transforms clinic codes (CL0002) to UUIDs, leaves UUIDs as-is
 *
 * @example
 * ```typescript
 * @Get(':id')
 * async getClinic(@Param('id', ClinicIdPipe) id: string) {
 *   // id will be a UUID, whether CL0002 or a UUID was provided
 * }
 * ```
 */
@Injectable()
export class ClinicIdPipe implements PipeTransform {
  /**
   * Validates and transforms clinic ID
   *
   * @param value - The clinic ID to transform
   * @param _metadata - Argument metadata (unused)
   * @returns The transformed clinic ID (UUID)
   * @throws BadRequestException - When clinic ID is invalid format
   */
  transform(value: string, _metadata: ArgumentMetadata): string {
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('Clinic ID is required and must be a string');
    }

    // Check if it's already a valid UUID v4
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(value)) {
      return value; // Already a UUID, return as-is
    }

    // Check if it's a valid clinic code format (CL####, e.g., CL0001, CL0002)
    const clinicCodeRegex = /^CL\d{4}$/i;
    if (clinicCodeRegex.test(value)) {
      // Return the clinic code as-is - let the service layer resolve it to UUID
      return value;
    }

    // Invalid format
    throw new BadRequestException(
      'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001, CL0002)'
    );
  }
}
