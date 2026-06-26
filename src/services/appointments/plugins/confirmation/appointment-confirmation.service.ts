import { nowIso } from '@utils/date-time.util';
import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';
import { LogType, LogLevel } from '@core/types';
import { QrService } from '@utils/QR';
import * as crypto from 'crypto';
import { NotFoundException } from '@nestjs/common';

import type { AppointmentQRCodeData, ConfirmationResult } from '@core/types/appointment.types';
import { EHRService } from '@services/ehr/ehr.service';

// Re-export types for backward compatibility (with alias for QRCodeData)
export type { ConfirmationResult };
export type QRCodeData = AppointmentQRCodeData;

interface ClinicalMedication {
  name: string;
  dosage?: string | undefined;
  frequency?: string | undefined;
  instructions?: string | undefined;
}
type ClinicalMedicationInput = string | ClinicalMedication;

@Injectable()
export class AppointmentConfirmationService {
  private readonly logger = new Logger(AppointmentConfirmationService.name);
  private readonly QR_CACHE_TTL = 3600; // 1 hour
  private readonly CONFIRMATION_CACHE_TTL = 1800; // 30 minutes

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService,
    private readonly qrService: QrService,
    private readonly ehrService: EHRService
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
        checkedInAt: nowIso(),
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
    domain: string,
    clinicalData?: {
      diagnosis?: string | undefined;
      treatmentPlan?: string | undefined;
      medications?: ClinicalMedicationInput[] | undefined;
      clinicId?: string | undefined;
      userId?: string | undefined;
    }
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Mark appointment as completed
      const completionResult = await this.performCompletion(
        appointmentId,
        doctorId,
        domain,
        clinicalData
      );

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
        verifiedAt: nowIso(),
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const secretKey =
      this.configService.getEnv('QR_ENCRYPTION_KEY', 'default-secret-key-32-chars-long') ||
      'default-secret-key-32-chars-long';
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
      // Use ConfigService (which uses dotenv) for environment variable access
      const secretKey =
        this.configService.getEnv('QR_ENCRYPTION_KEY', 'default-secret-key-32-chars-long') ||
        'default-secret-key-32-chars-long';
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

  private async performCheckIn(appointmentId: string, domain: string): Promise<unknown> {
    const now = new Date();
    const appointment = await this.getAppointmentContext(appointmentId);

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as {
          appointment: {
            update: (args: unknown) => Promise<unknown>;
          };
        };

        await typedClient.appointment.update({
          where: { id: appointmentId },
          data: {
            status: 'CONFIRMED',
            checkedInAt: now,
            updatedAt: now,
          },
        });
      },
      {
        userId: 'system',
        clinicId: appointment.clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointmentId,
        userRole: 'system',
        details: { status: 'CONFIRMED', domain },
      }
    );

    return {
      success: true,
      appointmentId,
      domain,
      checkedInAt: nowIso(),
      clinicId: appointment.clinicId,
    };
  }

  private async performConfirmation(appointmentId: string, domain: string): Promise<unknown> {
    const now = new Date();
    const appointment = await this.getAppointmentContext(appointmentId);

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as {
          appointment: {
            update: (args: unknown) => Promise<unknown>;
          };
        };

        await typedClient.appointment.update({
          where: { id: appointmentId },
          data: {
            status: 'CONFIRMED',
            updatedAt: now,
          },
        });
      },
      {
        userId: 'system',
        clinicId: appointment.clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointmentId,
        userRole: 'system',
        details: { status: 'CONFIRMED', domain },
      }
    );

    return {
      success: true,
      appointmentId,
      domain,
      confirmedAt: nowIso(),
      clinicId: appointment.clinicId,
    };
  }

  private async performCompletion(
    appointmentId: string,
    doctorId: string,
    domain: string,
    clinicalData?: {
      diagnosis?: string | undefined;
      treatmentPlan?: string | undefined;
      medications?: ClinicalMedicationInput[] | undefined;
      clinicId?: string | undefined;
      userId?: string | undefined;
    }
  ): Promise<unknown> {
    const appointment = await this.getAppointmentContext(appointmentId);
    const normalizedMedications = clinicalData?.medications
      ?.map((medication: ClinicalMedicationInput) => this.normalizeClinicalMedication(medication))
      .filter(
        (
          medication
        ): medication is {
          name: string;
          dosage: string;
          frequency: string;
          instructions?: string;
        } => medication !== null
      );

    // 1. If we have clinical data, persist it to EHR
    if (clinicalData && clinicalData.userId) {
      void this.ehrService
        .createPrescription({
          userId: clinicalData.userId,
          clinicId: appointment.clinicId,
          doctorId: doctorId,
          diagnosis: clinicalData.diagnosis,
          treatmentPlan: clinicalData.treatmentPlan,
          medications: normalizedMedications?.map(medication => ({
            name: medication.name,
            dosage: medication.dosage,
            frequency: medication.frequency,
            startDate: nowIso(),
            ...(medication.instructions !== undefined
              ? { instructions: medication.instructions }
              : {}),
          })),
          notes: clinicalData.treatmentPlan,
        })
        .catch(err => {
          this.logger.error(`Failed to persist EHR data for appointment ${appointmentId}:`, err);
        });
    }

    const now = new Date();
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as {
          appointment: {
            update: (args: unknown) => Promise<unknown>;
          };
        };

        await typedClient.appointment.update({
          where: { id: appointmentId },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            updatedAt: now,
          },
        });
      },
      {
        userId: clinicalData?.userId || 'system',
        clinicId: appointment.clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointmentId,
        userRole: 'system',
        details: {
          status: 'COMPLETED',
          doctorId,
          domain,
          hasClinicalData: Boolean(clinicalData?.userId),
        },
      }
    );

    return {
      success: true,
      appointmentId,
      doctorId,
      domain,
      completedAt: nowIso(),
      clinicId: appointment.clinicId,
    };
  }

  private async getAppointmentContext(appointmentId: string): Promise<{
    id: string;
    clinicId: string;
    status: string;
  }> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        appointment: {
          findFirst: (args: unknown) => Promise<{
            id: string;
            clinicId: string;
            status: string;
          } | null>;
        };
      };

      return await typedClient.appointment.findFirst({
        where: { id: appointmentId },
        select: { id: true, clinicId: true, status: true },
      });
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment not found: ${appointmentId}`);
    }

    return appointment;
  }

  private async verifyAppointment(
    appointmentId: string,
    clinicId: string,
    domain: string
  ): Promise<unknown> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        appointment: {
          findFirst: (args: unknown) => Promise<{
            id: string;
            clinicId: string;
            status: string;
            checkedInAt: Date | null;
            completedAt: Date | null;
          } | null>;
        };
      };

      return await typedClient.appointment.findFirst({
        where: {
          id: appointmentId,
          clinicId,
        },
        select: {
          id: true,
          clinicId: true,
          status: true,
          checkedInAt: true,
          completedAt: true,
        },
      });
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment not found: ${appointmentId}`);
    }

    return {
      id: appointment.id,
      clinicId: appointment.clinicId,
      domain,
      status: appointment.status,
      checkedInAt: appointment.checkedInAt?.toISOString() || null,
      completedAt: appointment.completedAt?.toISOString() || null,
    };
  }

  private normalizeClinicalMedication(
    medication: ClinicalMedicationInput
  ): { name: string; dosage: string; frequency: string; instructions?: string } | null {
    if (typeof medication === 'string') {
      const name = medication.trim();
      if (!name) return null;

      return {
        name,
        dosage: 'AS_DIRECTED',
        frequency: 'AS_DIRECTED',
      };
    }

    const name = medication.name?.trim();
    if (!name) return null;

    return {
      name,
      dosage:
        typeof medication.dosage === 'string' && medication.dosage.trim()
          ? medication.dosage
          : 'AS_DIRECTED',
      frequency:
        typeof medication.frequency === 'string' && medication.frequency.trim()
          ? medication.frequency
          : 'AS_DIRECTED',
      ...(medication.instructions !== undefined ? { instructions: medication.instructions } : {}),
    };
  }
}
