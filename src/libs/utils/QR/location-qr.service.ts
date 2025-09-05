import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';

@Injectable()
export class LocationQrService {
  constructor() {}

  /**
   * Generate a QR code for a specific clinic location
   * @param locationId - The ID of the clinic location
   * @returns Promise<string> - Base64 encoded QR code image
   */
  async generateLocationQR(locationId: string): Promise<string> {
    try {
      // Create QR data with location information
      const qrData = {
        locationId,
        type: 'LOCATION_CHECK_IN',
        timestamp: new Date().toISOString(),
      };

      // Generate QR code
      // Note: This would integrate with QrService in a real implementation
      return JSON.stringify(qrData);
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : String(error);
      throw new BadRequestException(`Failed to generate location QR: ${message}`);
    }
  }

  /**
   * Verify QR code for a specific location
   * @param qrData - The data scanned from the QR code
   * @param appointmentLocationId - The location ID from the appointment
   * @returns boolean - Whether the QR code is valid for this location
   */
  async verifyLocationQR(qrData: string, appointmentLocationId: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrData);
      
      // Validate QR data format
      if (data.type !== 'LOCATION_CHECK_IN') {
        throw new BadRequestException('Invalid QR code type');
      }

      // Verify if the QR code is for the correct location
      if (data.locationId !== appointmentLocationId) {
        throw new BadRequestException('QR code is not valid for this location');
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : String(error);
      throw new BadRequestException(`Invalid QR code: ${message}`);
    }
  }
} 