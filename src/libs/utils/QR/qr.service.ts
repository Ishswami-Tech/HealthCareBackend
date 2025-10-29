import { Injectable } from "@nestjs/common";
import * as QRCode from "qrcode";
import { Logger } from "@nestjs/common";

/**
 * QR Code Service for Healthcare Applications
 *
 * Provides QR code generation and verification functionality for healthcare
 * applications including appointment QR codes and general QR code operations.
 *
 * @class QrService
 * @description Service for generating and verifying QR codes with healthcare-specific features
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 *
 * @example
 * ```typescript
 * // Inject the service
 * constructor(private readonly qrService: QrService) {}
 *
 * // Generate appointment QR code
 * const qrCode = await this.qrService.generateAppointmentQR('appointment-123');
 *
 * // Verify appointment QR code
 * const appointmentId = this.qrService.verifyAppointmentQR(qrData);
 * ```
 */
@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  /**
   * Creates an instance of QrService
   */
  constructor() {}

  /**
   * Generate a QR code for an appointment
   *
   * @param appointmentId - The appointment ID
   * @returns Promise<string> - Base64 encoded QR code data URL
   *
   * @description Generates a QR code containing appointment information that can be
   * used for appointment confirmation and check-in processes. The QR code includes
   * appointment ID and timestamp for security.
   *
   * @example
   * ```typescript
   * const qrCode = await this.qrService.generateAppointmentQR('appointment-123');
   * // Returns: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
   * ```
   *
   * @throws {Error} When QR code generation fails
   */
  async generateAppointmentQR(appointmentId: string): Promise<string> {
    try {
      // Create a unique token that includes appointment ID and timestamp
      const token = `appointment:${appointmentId}:${Date.now()}`;

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(token);
      return qrCodeDataUrl;
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : "Unknown error";
      const _stack = _error instanceof Error ? _error.stack : undefined;
      this.logger.error(`Failed to generate QR code: ${_message}`, _stack);
      throw new Error("Failed to generate QR code");
    }
  }

  /**
   * Verify QR code for appointment confirmation
   *
   * @param qrData - The data scanned from the QR code
   * @returns string - The appointment ID extracted from the QR code
   *
   * @description Verifies and extracts appointment ID from a scanned QR code.
   * Validates the QR code format and returns the appointment ID for further processing.
   *
   * @example
   * ```typescript
   * const appointmentId = this.qrService.verifyAppointmentQR('appointment:123:1640995200000');
   * // Returns: '123'
   * ```
   *
   * @throws {Error} When QR code format is invalid
   */
  verifyAppointmentQR(qrData: string): string {
    try {
      // Validate QR data format
      const parts = qrData.split(":");
      if (parts.length !== 3 || parts[0] !== "appointment") {
        throw new Error("Invalid QR code format");
      }

      // Extract appointment ID
      const appointmentId = parts[1];
      if (!appointmentId) {
        throw new Error("Invalid QR code format - missing appointment ID");
      }
      return appointmentId;
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : "Unknown error";
      const _stack = _error instanceof Error ? _error.stack : undefined;
      this.logger.error(`Failed to verify QR code: ${_message}`, _stack);
      throw new Error("Failed to verify QR code");
    }
  }

  /**
   * Generate a QR code from data
   *
   * @param data - Data to encode in QR code
   * @returns Promise<string> - Base64 encoded QR code image
   *
   * @description Generates a QR code from any string data. This is a general-purpose
   * method for creating QR codes from arbitrary data.
   *
   * @example
   * ```typescript
   * const qrCode = await this.qrService.generateQR('Hello World');
   * // Returns: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
   * ```
   *
   * @throws {Error} When QR code generation fails
   */
  async generateQR(data: string): Promise<string> {
    try {
      return await QRCode.toDataURL(data);
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : "Unknown error";
      throw new Error(`Failed to generate QR code: ${_message}`);
    }
  }

  /**
   * Verify QR code data
   *
   * @param qrData - Data from scanned QR code
   * @returns unknown - Decoded data object
   *
   * @description Parses JSON data from a scanned QR code. This method assumes
   * the QR code contains valid JSON data.
   *
   * @example
   * ```typescript
   * const data = this.qrService.verifyQR('{"id":"123","type":"appointment"}');
   * // Returns: { id: '123', type: 'appointment' }
   * ```
   *
   * @throws {Error} When QR code data is not valid JSON
   */
  verifyQR(qrData: string): unknown {
    try {
      return JSON.parse(qrData);
    } catch (_error) {
      const _message =
        _error instanceof Error ? _error.message : "Unknown error";
      throw new Error(`Invalid QR code data: ${_message}`);
    }
  }
}
