import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface LocationQRData {
  locationId: string;
  clinicId: string;
  type: string;
  timestamp: string;
  signature: string;
}

@Injectable()
export class LocationQrService {
  private readonly logger = new Logger(LocationQrService.name);
  private readonly SECRET_KEY: string;

  constructor(private readonly configService: ConfigService) {
    this.SECRET_KEY = this.configService.get<string>('QR_SECRET_KEY') || 'fallback_dev_secret';
  }

  generateLocationQR(locationId: string, clinicId: string): string {
    const payload = {
      locationId,
      clinicId,
      type: 'LOCATION_CHECK_IN',
      timestamp: new Date().toISOString(),
    };

    const signature = this.generateSignature(payload);

    // Return compact JSON string
    return JSON.stringify({ ...payload, signature });
  }

  verifyLocationQR(
    qrDataString: string,
    expectedLocationId: string,
    expectedClinicId: string
  ): boolean {
    try {
      const data = JSON.parse(qrDataString) as LocationQRData;

      // Basic validation
      if (!data.locationId || !data.clinicId || !data.type || !data.timestamp || !data.signature) {
        this.logger.warn('Invalid QR data structure');
        return false;
      }

      // Context validation
      if (data.locationId !== expectedLocationId) {
        this.logger.warn(
          `Location mismatch: expected ${expectedLocationId}, got ${data.locationId}`
        );
        return false;
      }

      if (data.clinicId !== expectedClinicId) {
        this.logger.warn(`Clinic mismatch: expected ${expectedClinicId}, got ${data.clinicId}`);
        return false;
      }

      if (data.type !== 'LOCATION_CHECK_IN') {
        this.logger.warn(`Invalid QR type: ${data.type}`);
        return false;
      }

      // Verify signature
      const { signature, ...payload } = data;
      const expectedSignature = this.generateSignature(payload);

      if (signature !== expectedSignature) {
        this.logger.warn('Invalid HMAC signature');
        return false;
      }

      // Optional: Timestamp expiry check could be added here

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to verify QR: ${errorMessage}`);
      return false;
    }
  }

  private generateSignature(payload: Omit<LocationQRData, 'signature'>): string {
    // Sort keys to ensure deterministic string or use specific order
    const dataString = `${payload.clinicId}:${payload.locationId}:${payload.type}:${payload.timestamp}`;
    return crypto.createHmac('sha256', this.SECRET_KEY).update(dataString).digest('hex');
  }
}
