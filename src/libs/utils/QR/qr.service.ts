import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Logger } from '@nestjs/common';

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  /**
   * Generate a QR code for an appointment
   * @param appointmentId - The appointment ID
   * @returns Promise with the QR code data URL
   */
  async generateAppointmentQR(appointmentId: string): Promise<string> {
    try {
      // Create a unique token that includes appointment ID and timestamp
      const token = `appointment:${appointmentId}:${Date.now()}`;
      
      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(token);
      return qrCodeDataUrl;
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to generate QR code: ${message}`, stack);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Verify QR code for appointment confirmation
   * @param qrData - The data scanned from the QR code
   * @returns The appointment ID extracted from the QR code
   */
  verifyAppointmentQR(qrData: string): string {
    try {
      // Validate QR data format
      const parts = qrData.split(':');
      if (parts.length !== 3 || parts[0] !== 'appointment') {
        throw new Error('Invalid QR code format');
      }
      
      // Extract appointment ID
      const appointmentId = parts[1];
      return appointmentId;
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to verify QR code: ${message}`, stack);
      throw new Error('Failed to verify QR code');
    }
  }

  /**
   * Generate a QR code from data
   * @param data - Data to encode in QR code
   * @returns Promise<string> - Base64 encoded QR code image
   */
  async generateQR(data: string): Promise<string> {
    try {
      return await QRCode.toDataURL(data);
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : 'Unknown error';
      throw new Error(`Failed to generate QR code: ${message}`);
    }
  }

  /**
   * Verify QR code data
   * @param qrData - Data from scanned QR code
   * @returns Decoded data object
   */
  verifyQR(qrData: string): any {
    try {
      return JSON.parse(qrData);
    } catch (error) {
      const message = error instanceof Error ? (error as Error).message : 'Unknown error';
      throw new Error(`Invalid QR code data: ${message}`);
    }
  }
} 