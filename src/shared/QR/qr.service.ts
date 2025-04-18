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
      this.logger.error(`Failed to generate QR code: ${error.message}`, error.stack);
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
      this.logger.error(`Failed to verify QR code: ${error.message}`, error.stack);
      throw new Error('Failed to verify QR code');
    }
  }
} 