import { nowIso } from '@utils/date-time.util';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import * as crypto from 'crypto';

export interface LocationQRData {
  locationId: string;
  clinicId: string;
  type: string;
  timestamp: string;
  /** Poster version; absent on posters printed before rotation existed (= version 1). */
  version?: number;
  signature: string;
}

export type LocationQrInspection = 'VALID' | 'INVALID' | 'REPLACED';

@Injectable()
export class LocationQrService {
  private readonly logger = new Logger(LocationQrService.name);
  private readonly SECRET_KEY: string;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService
  ) {
    const configuredKey =
      this.configService.getEnv('QR_SECRET_KEY') || this.configService.getEnv('QR_ENCRYPTION_KEY');
    if (!configuredKey && this.isProductionEnv()) {
      // Do not crash startup, but make the misconfiguration loud: with the dev fallback anyone
      // who knows it can forge check-in posters.
      this.logger.error(
        'QR_SECRET_KEY / QR_ENCRYPTION_KEY is not set in production - location QR posters are ' +
          'signed with the insecure development fallback key. Set QR_SECRET_KEY.'
      );
    }
    this.SECRET_KEY = configuredKey || 'fallback_dev_secret';
  }

  private isProductionEnv(): boolean {
    try {
      return this.configService.isProduction();
    } catch {
      return (process.env['NODE_ENV'] ?? '').toLowerCase() === 'production';
    }
  }

  generateLocationQR(locationId: string, clinicId: string, version = 1): string {
    const payload = {
      locationId,
      clinicId,
      type: 'LOCATION_CHECK_IN',
      timestamp: nowIso(),
      version,
    };

    const signature = this.generateSignature(payload);

    // Return compact JSON string
    return JSON.stringify({ ...payload, signature });
  }

  verifyLocationQR(
    qrDataString: string,
    expectedLocationId: string,
    expectedClinicId: string,
    expectedVersion?: number
  ): boolean {
    return (
      this.inspectLocationQR(
        qrDataString,
        expectedLocationId,
        expectedClinicId,
        expectedVersion
      ) === 'VALID'
    );
  }

  /**
   * Like verifyLocationQR but tells a forged / foreign poster (INVALID) from a genuine poster that
   * was replaced by a QR regenerate (REPLACED), so the check-in log can show "expired QR".
   */
  inspectLocationQR(
    qrDataString: string,
    expectedLocationId: string,
    expectedClinicId: string,
    expectedVersion?: number
  ): LocationQrInspection {
    try {
      const data = JSON.parse(qrDataString) as LocationQRData;

      // Basic validation
      if (!data.locationId || !data.clinicId || !data.type || !data.timestamp || !data.signature) {
        this.logger.warn('Invalid QR data structure');
        return 'INVALID';
      }

      // Context validation
      if (data.locationId !== expectedLocationId) {
        this.logger.warn(
          `Location mismatch: expected ${expectedLocationId}, got ${data.locationId}`
        );
        return 'INVALID';
      }

      if (data.clinicId !== expectedClinicId) {
        this.logger.warn(`Clinic mismatch: expected ${expectedClinicId}, got ${data.clinicId}`);
        return 'INVALID';
      }

      if (data.type !== 'LOCATION_CHECK_IN') {
        this.logger.warn(`Invalid QR type: ${data.type}`);
        return 'INVALID';
      }

      // Verify signature
      const { signature, ...payload } = data;
      const expectedSignature = this.generateSignature(payload);

      if (!LocationQrService.signaturesMatch(signature, expectedSignature)) {
        this.logger.warn('Invalid HMAC signature');
        return 'INVALID';
      }

      // A genuine poster of an older version was replaced by a QR regenerate.
      if (expectedVersion !== undefined && (data.version ?? 1) !== expectedVersion) {
        this.logger.warn(`Replaced QR poster: v${data.version ?? 1}, current v${expectedVersion}`);
        return 'REPLACED';
      }

      return 'VALID';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to verify QR: ${errorMessage}`);
      return 'INVALID';
    }
  }

  /** Constant-time comparison of two hex signatures (false on any length mismatch). */
  private static signaturesMatch(given: unknown, expected: string): boolean {
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private generateSignature(payload: Omit<LocationQRData, 'signature'>): string {
    // Sort keys to ensure deterministic string or use specific order
    // Posters printed before rotation existed carry no version and keep their original signature.
    const versionSuffix = payload.version === undefined ? '' : `:v${payload.version}`;
    const dataString = `${payload.clinicId}:${payload.locationId}:${payload.type}:${payload.timestamp}${versionSuffix}`;
    return crypto.createHmac('sha256', this.SECRET_KEY).update(dataString).digest('hex');
  }
}
