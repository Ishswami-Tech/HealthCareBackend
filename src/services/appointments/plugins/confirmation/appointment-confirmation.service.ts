import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { QrService } from '@utils/QR';
import * as crypto from 'crypto';

import type { AppointmentQRCodeData, ConfirmationResult } from '@core/types/appointment.types';

// Re-export types for backward compatibility (with alias for QRCodeData)
export type { ConfirmationResult };
export type QRCodeData = AppointmentQRCodeData;

@Injectable()
export class AppointmentConfirmationService {
  private readonly logger = new Logger(AppointmentConfirmationService.name);
  private readonly QR_CACHE_TTL = 3600; // 1 hour
  private readonly CONFIRMATION_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly qrService: QrService
  ) {}

  async generateCheckInQR(appointmentId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `qr:checkin:${appointmentId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Check-in QR retrieved from cache',
          'AppointmentConfirmationService',
          { appointmentId, domain, responseTime: Date.now() - startTime }
        );
        return JSON.parse(cached as string);
      }

      // Generate QR code data
      const qrData: QRCodeData = {
        appointmentId,
        domain,
        timestamp: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        type: 'check-in',
      };

      // Encrypt QR data
      const encryptedData = this.encryptQRData(qrData);

      // Generate QR code using existing service
      const qrCodeImage = await this.qrService.generateQR(encryptedData);

      const result = {
        qrCode: encryptedData,
        qrImage: qrCodeImage,
        appointmentId,
        domain,
        expiresAt: new Date(qrData.expiresAt).toISOString(),
        type: 'check-in',
      };

      // Cache the QR code
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QR_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Check-in QR generated successfully',
        'AppointmentConfirmationService',
        { appointmentId, domain, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate check-in QR: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async processCheckIn(qrData: string, appointmentId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Decrypt and validate QR data
      const decodedData = this.decryptQRData(qrData);

      if (!decodedData || decodedData.appointmentId !== appointmentId) {
        throw new BadRequestException('Invalid QR code for this appointment');
      }

      if (decodedData.expiresAt < Date.now()) {
        throw new BadRequestException('QR code has expired');
      }

      if (decodedData.domain !== domain) {
        throw new BadRequestException('QR code is not valid for this domain');
      }

      // Process check-in
      await this.performCheckIn(appointmentId, domain);

      // Invalidate QR cache
      await this.cacheService.del(`qr:checkin:${appointmentId}:${domain}`);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in processed successfully',
        'AppointmentConfirmationService',
        { appointmentId, domain, responseTime: Date.now() - startTime }
      );

      return {
        success: true,
        appointmentId,
        domain,
        checkedInAt: new Date().toISOString(),
        message: 'Check-in successful',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          qrData,
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async confirmAppointment(appointmentId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `confirmation:${appointmentId}:${domain}`;

    try {
      // Check if already confirmed
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Perform confirmation logic
      const confirmationResult = await this.performConfirmation(appointmentId, domain);

      // Cache confirmation
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(confirmationResult),
        this.CONFIRMATION_CACHE_TTL
      );

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Appointment confirmed successfully',
        'AppointmentConfirmationService',
        { appointmentId, domain, responseTime: Date.now() - startTime }
      );

      return confirmationResult;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async markAppointmentCompleted(
    appointmentId: string,
    doctorId: string,
    domain: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Mark appointment as completed
      const completionResult = await this.performCompletion(appointmentId, doctorId, domain);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Appointment marked as completed',
        'AppointmentConfirmationService',
        {
          appointmentId,
          doctorId,
          domain,
          responseTime: Date.now() - startTime,
        }
      );

      return completionResult;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to mark appointment completed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          appointmentId,
          doctorId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async generateConfirmationQR(appointmentId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `qr:confirmation:${appointmentId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Generate QR code data
      const qrData: QRCodeData = {
        appointmentId,
        domain,
        timestamp: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
        type: 'confirmation',
      };

      // Encrypt QR data
      const encryptedData = this.encryptQRData(qrData);

      // Generate QR code using existing service
      const qrCodeImage = await this.qrService.generateQR(encryptedData);

      const result = {
        qrCode: encryptedData,
        qrImage: qrCodeImage,
        appointmentId,
        domain,
        expiresAt: new Date(qrData.expiresAt).toISOString(),
        type: 'confirmation',
      };

      // Cache the QR code
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QR_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Confirmation QR generated successfully',
        'AppointmentConfirmationService',
        { appointmentId, domain, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate confirmation QR: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async verifyAppointmentQR(qrData: string, clinicId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Decrypt and validate QR data
      const decodedData = this.decryptQRData(qrData);

      if (!decodedData) {
        throw new BadRequestException('Invalid QR code format');
      }

      if (decodedData.expiresAt < Date.now()) {
        throw new BadRequestException('QR code has expired');
      }

      if (decodedData.domain !== domain) {
        throw new BadRequestException('QR code is not valid for this domain');
      }

      // Verify appointment exists and belongs to clinic
      await this.verifyAppointment(decodedData.appointmentId, clinicId, domain);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Appointment QR verified successfully',
        'AppointmentConfirmationService',
        {
          appointmentId: decodedData.appointmentId,
          clinicId,
          domain,
          responseTime: Date.now() - startTime,
        }
      );

      return {
        success: true,
        appointmentId: decodedData.appointmentId,
        clinicId,
        domain,
        verifiedAt: new Date().toISOString(),
        type: decodedData.type,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify appointment QR: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          qrData,
          clinicId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async invalidateQRCache(appointmentId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Invalidate all QR caches for this appointment
      const patterns = [`qr:checkin:${appointmentId}:*`, `qr:confirmation:${appointmentId}:*`];

      await Promise.all(patterns.map(pattern => this.cacheService.invalidateByPattern(pattern)));

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'QR cache invalidated successfully',
        'AppointmentConfirmationService',
        { appointmentId, responseTime: Date.now() - startTime }
      );

      return { success: true, message: 'QR cache invalidated' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate QR cache: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentConfirmationService',
        {
          appointmentId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // Helper methods
  private encryptQRData(data: QRCodeData): string {
    const secretKey = process.env['QR_ENCRYPTION_KEY'] || 'default-secret-key-32-chars-long';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(secretKey.padEnd(32, '0').slice(0, 32)),
      iv
    );
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decryptQRData(encryptedData: string): QRCodeData | null {
    try {
      const secretKey = process.env['QR_ENCRYPTION_KEY'] || 'default-secret-key-32-chars-long';
      const [ivHex, encrypted] = encryptedData.split(':');
      if (!ivHex || !encrypted) return null;
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(secretKey.padEnd(32, '0').slice(0, 32)),
        iv
      );
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted = decrypted + decipher.final('utf8');
      const parsed = JSON.parse(decrypted) as QRCodeData;
      return parsed;
    } catch (_error) {
      this.logger.error('Failed to decrypt QR data:', _error);
      return null;
    }
  }

  private performCheckIn(_appointmentId: string, _domain: string): Promise<unknown> {
    // This would integrate with the actual appointment service
    // For now, return a placeholder implementation
    return Promise.resolve({
      success: true,
      appointmentId: _appointmentId,
      domain: _domain,
      checkedInAt: new Date().toISOString(),
    });
  }

  private performConfirmation(_appointmentId: string, _domain: string): Promise<unknown> {
    // This would integrate with the actual appointment service
    // For now, return a placeholder implementation
    return Promise.resolve({
      success: true,
      appointmentId: _appointmentId,
      domain: _domain,
      confirmedAt: new Date().toISOString(),
    });
  }

  private performCompletion(
    _appointmentId: string,
    _doctorId: string,
    _domain: string
  ): Promise<unknown> {
    // This would integrate with the actual appointment service
    // For now, return a placeholder implementation
    return Promise.resolve({
      success: true,
      appointmentId: _appointmentId,
      doctorId: _doctorId,
      domain: _domain,
      completedAt: new Date().toISOString(),
    });
  }

  private verifyAppointment(
    _appointmentId: string,
    _clinicId: string,
    _domain: string
  ): Promise<unknown> {
    // This would integrate with the actual appointment service
    // For now, return a placeholder implementation
    return Promise.resolve({
      id: _appointmentId,
      clinicId: _clinicId,
      domain: _domain,
      status: 'CONFIRMED',
    });
  }
}
