import { Injectable } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";

/**
 * Interface for location QR data structure
 */
interface LocationQRData {
  locationId: string;
  type: string;
  timestamp: string;
}

/**
 * Location QR Service for Healthcare Applications
 *
 * Provides QR code generation and verification for clinic locations,
 * enabling location-based check-in functionality for healthcare applications.
 *
 * @class LocationQrService
 * @description Service for generating and verifying location-based QR codes
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 *
 * @example
 * ```typescript
 * // Inject the service
 * constructor(private readonly locationQrService: LocationQrService) {}
 *
 * // Generate QR code for location
 * const qrData = await this.locationQrService.generateLocationQR('location-123');
 *
 * // Verify QR code
 * const isValid = await this.locationQrService.verifyLocationQR(qrData, 'location-123');
 * ```
 */
@Injectable()
export class LocationQrService {
  /**
   * Creates an instance of LocationQrService
   */
  constructor() {}

  /**
   * Generate a QR code for a specific clinic location
   *
   * @param locationId - The ID of the clinic location
   * @returns Promise<string> - JSON string containing location QR data
   *
   * @description Generates QR code data for a specific clinic location that can be
   * used for location-based check-in functionality. The QR code contains location
   * information and timestamp for validation.
   *
   * @example
   * ```typescript
   * const qrData = await this.locationQrService.generateLocationQR('location-123');
   * // Returns: '{"locationId":"location-123","type":"LOCATION_CHECK_IN","timestamp":"2024-01-01T00:00:00.000Z"}'
   * ```
   *
   * @throws {BadRequestException} When QR code generation fails
   */
  generateLocationQR(locationId: string): Promise<string> {
    try {
      // Create QR data with location information
      const qrData: LocationQRData = {
        locationId,
        type: "LOCATION_CHECK_IN",
        timestamp: new Date().toISOString(),
      };

      // Generate QR code
      // Note: This would integrate with QrService in a real implementation
      return Promise.resolve(JSON.stringify(qrData));
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : String(_error);
      throw new BadRequestException(
        `Failed to generate location QR: ${_message}`,
      );
    }
  }

  /**
   * Verify QR code for a specific location
   *
   * @param qrData - The data scanned from the QR code
   * @param appointmentLocationId - The location ID from the appointment
   * @returns Promise<boolean> - Whether the QR code is valid for this location
   *
   * @description Verifies that a scanned QR code is valid for the specified location.
   * Validates the QR code format and ensures it matches the expected location ID.
   *
   * @example
   * ```typescript
   * const isValid = await this.locationQrService.verifyLocationQR(
   *   '{"locationId":"location-123","type":"LOCATION_CHECK_IN","timestamp":"2024-01-01T00:00:00.000Z"}',
   *   'location-123'
   * );
   * // Returns: true if valid, throws BadRequestException if invalid
   * ```
   *
   * @throws {BadRequestException} When QR code is invalid or doesn't match location
   */
  verifyLocationQR(
    qrData: string,
    appointmentLocationId: string,
  ): Promise<boolean> {
    try {
      const data = JSON.parse(qrData) as LocationQRData;

      // Validate QR data format
      if (data.type !== "LOCATION_CHECK_IN") {
        throw new BadRequestException("Invalid QR code type");
      }

      // Verify if the QR code is for the correct location
      if (data.locationId !== appointmentLocationId) {
        throw new BadRequestException("QR code is not valid for this location");
      }

      return Promise.resolve(true);
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : String(_error);
      throw new BadRequestException(`Invalid QR code: ${_message}`);
    }
  }
}
