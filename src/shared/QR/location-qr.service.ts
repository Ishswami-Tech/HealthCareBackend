import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { QrService } from './qr.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

@Injectable()
export class LocationQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
  ) {}

  /**
   * Generate a QR code for a specific clinic location
   * @param locationId - The ID of the clinic location
   * @returns Promise<string> - Base64 encoded QR code image
   */
  async generateLocationQR(locationId: string): Promise<string> {
    try {
      // Verify if location exists
      const location = await this.prisma.clinicLocation.findUnique({
        where: { id: locationId },
        include: {
          clinic: true,
        },
      });

      if (!location) {
        throw new NotFoundException(`Clinic location with ID ${locationId} not found`);
      }

      // Create QR data with location and clinic information
      const qrData = {
        locationId,
        clinicId: location.clinicId,
        clinicName: location.clinic.name,
        locationName: location.name,
        type: 'LOCATION_CHECK_IN',
        timestamp: new Date().toISOString(),
      };

      // Generate QR code
      return await this.qrService.generateQR(JSON.stringify(qrData));
    } catch (error) {
      throw new BadRequestException(`Failed to generate location QR: ${error.message}`);
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

      // Verify if location exists and is active
      const location = await this.prisma.clinicLocation.findUnique({
        where: { 
          id: data.locationId,
          isActive: true,
        },
      });

      if (!location) {
        throw new NotFoundException('Invalid or inactive clinic location');
      }

      return true;
    } catch (error) {
      throw new BadRequestException(`Invalid QR code: ${error.message}`);
    }
  }
} 