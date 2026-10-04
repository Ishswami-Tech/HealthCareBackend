import { nowIso } from '@utils/date-time.util';
import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';
import { LogType, LogLevel } from '@core/types';
import { QrService } from '@utils/QR';
import * as crypto from 'crypto';
import { NotFoundException } from '@nestjs/common';

import type { AppointmentQRCodeData, ConfirmationResult } from '@core/types/appointment.types';
import {
  isInPersonAppointmentType,
  isVideoCallAppointmentType,
} from '@core/types/appointment-guards.types';
import { EHRService } from '@services/ehr/ehr.service';
import { CheckInLocationService } from '@services/appointments/plugins/therapy/check-in-location.service';
import type { TreatmentPlanDto } from '@dtos/appointment.dto';
import type { PluginCaller } from '../base/plugin-caller';

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

/** Shown when the clinic confirmation / check-in plugin is pointed at a video appointment. */
export const VIDEO_CONFIRMATION_REJECTION_MESSAGE =
  'Video appointments are confirmed by payment, not by clinic confirmation or check-in';

/** Statuses a clinic arrival / confirmation can still be recorded from. */
const CONFIRMABLE_STATUSES: ReadonlySet<string> = new Set<string>(['SCHEDULED', 'CONFIRMED']);

/** A completion needs a visit under way; an already completed one only re-runs the EHR side effects. */
const COMPLETION_CONTEXT_STATUSES: ReadonlySet<string> = new Set<string>([
  'IN_PROGRESS',
  'COMPLETED',
]);

/**
 * What a plugin operation is allowed to touch. `clinicId` is the clinic the request was validated
 * for (ClinicGuard): every read and write is filtered by it. It is undefined only for a
 * SUPER_ADMIN without a clinic header (global scope) and for trusted server-side callers.
 */
export interface ConfirmationScope {
  readonly clinicId?: string | undefined;
  readonly caller?: PluginCaller | undefined;
}

interface AppointmentContext {
  id: string;
  clinicId: string;
  status: string;
  type: string;
  locationId: string | null;
  patientId: string;
}

@Injectable()
export class AppointmentConfirmationService {
  private readonly logger = new Logger(AppointmentConfirmationService.name);
  private readonly QR_CACHE_TTL = 3600; // 1 hour

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService,
    private readonly qrService: QrService,
    private readonly ehrService: EHRService,
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocationService: CheckInLocationService
  ) {}

  async generateCheckInQR(
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope = {}
  ): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `qr:checkin:${appointmentId}:${domain}`;

    try {
      // The appointment must exist in the caller's clinic before a QR (or a cached one) is handed out.
      await this.getAppointmentContext(appointmentId, scope);

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

  async processCheckIn(
    qrData: string,
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope = {}
  ): Promise<unknown> {
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
      await this.performCheckIn(appointmentId, domain, scope);

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

  async confirmAppointment(
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope = {}
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // A confirmation is a write, never served from a result cache: a cached answer could be for
      // another clinic's appointment or for one that has been cancelled since.
      const confirmationResult = await this.performConfirmation(appointmentId, domain, scope);

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
      treatmentPlan?: TreatmentPlanDto | undefined;
      medications?: ClinicalMedicationInput[] | undefined;
      clinicId?: string | undefined;
      userId?: string | undefined;
      caller?: PluginCaller | undefined;
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

  async generateConfirmationQR(
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope = {}
  ): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `qr:confirmation:${appointmentId}:${domain}`;

    try {
      // The appointment must exist in the caller's clinic before a QR (or a cached one) is handed out.
      await this.getAppointmentContext(appointmentId, scope);

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

  async invalidateQRCache(appointmentId: string, scope: ConfirmationScope = {}): Promise<unknown> {
    const startTime = Date.now();

    try {
      await this.getAppointmentContext(appointmentId, scope);

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

  /**
   * Clinic arrival for an in-person appointment through the one check-in implementation every
   * entry point shares (`CheckInLocationService.processCheckIn`): atomic SCHEDULED -> CONFIRMED
   * with a CheckIn row, plan coverage, the same-IST-day rule, and an entry in the doctor's live
   * queue (verified and repaired on retry). A bare status update would confirm the appointment
   * without ever queueing it. Video appointments are refused: payment confirms those.
   */
  private async confirmInPersonArrival(
    appointmentId: string,
    scope: ConfirmationScope
  ): Promise<AppointmentContext> {
    const appointment = await this.getAppointmentContext(appointmentId, scope);

    if (isVideoCallAppointmentType(appointment.type)) {
      throw new BadRequestException(VIDEO_CONFIRMATION_REJECTION_MESSAGE);
    }
    if (!isInPersonAppointmentType(appointment.type)) {
      throw new BadRequestException(
        'Only in-person appointments can be confirmed through clinic check-in'
      );
    }
    if (!CONFIRMABLE_STATUSES.has(String(appointment.status).toUpperCase())) {
      throw new BadRequestException('Appointment can no longer be checked in');
    }
    if (!appointment.locationId) {
      throw new BadRequestException('This appointment has no clinic location to check in at');
    }

    await this.checkInLocationService.processCheckIn(
      {
        appointmentId,
        locationId: appointment.locationId,
        patientId: appointment.patientId,
      },
      appointment.clinicId,
      { ...(scope.caller ? { actor: scope.caller } : {}), presence: 'skip' }
    );

    return appointment;
  }

  private async performCheckIn(
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope
  ): Promise<unknown> {
    const appointment = await this.confirmInPersonArrival(appointmentId, scope);

    return {
      success: true,
      appointmentId,
      domain,
      checkedInAt: nowIso(),
      clinicId: appointment.clinicId,
    };
  }

  private async performConfirmation(
    appointmentId: string,
    domain: string,
    scope: ConfirmationScope
  ): Promise<unknown> {
    const appointment = await this.confirmInPersonArrival(appointmentId, scope);

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
      treatmentPlan?: TreatmentPlanDto | undefined;
      medications?: ClinicalMedicationInput[] | undefined;
      clinicId?: string | undefined;
      userId?: string | undefined;
      caller?: PluginCaller | undefined;
    }
  ): Promise<unknown> {
    const appointment = await this.getAppointmentContext(appointmentId, {
      clinicId: clinicalData?.clinicId,
      caller: clinicalData?.caller,
    });
    const currentStatus = String(appointment.status).toUpperCase();
    if (!COMPLETION_CONTEXT_STATUSES.has(currentStatus)) {
      throw new BadRequestException('Only an appointment that is in progress can be completed');
    }
    // Video completion carries doctor / payment rules that live in the appointment completion
    // flow. That flow claims the COMPLETED status first and only then calls this method for the
    // EHR side effects, so a video visit that is still IN_PROGRESS here would be a shortcut
    // around those rules.
    if (isVideoCallAppointmentType(appointment.type) && currentStatus === 'IN_PROGRESS') {
      throw new BadRequestException(
        'Video appointments are completed through the appointment completion flow'
      );
    }

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
          notes: this.summarizeTreatmentPlan(clinicalData.treatmentPlan),
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
            updateMany: (args: unknown) => Promise<{ count: number }>;
          };
        };

        // Conditional: only a visit that is actually in progress can be completed, and only in the
        // clinic it was read from. An unconditional update turned a CANCELLED / EXPIRED / NO_SHOW
        // row into COMPLETED. When the caller has already claimed the completion (status is
        // COMPLETED) this matches nothing.
        await typedClient.appointment.updateMany({
          where: { id: appointmentId, clinicId: appointment.clinicId, status: 'IN_PROGRESS' },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            updatedAt: now,
          },
        });
      },
      {
        userId: clinicalData?.caller?.userId || clinicalData?.userId || 'system',
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

  /**
   * Read the appointment a plugin operation acts on, filtered by the clinic the request was
   * validated for. Another clinic's appointment is indistinguishable from a missing one (404).
   */
  private async getAppointmentContext(
    appointmentId: string,
    scope: ConfirmationScope
  ): Promise<AppointmentContext> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        appointment: {
          findFirst: (args: unknown) => Promise<AppointmentContext | null>;
        };
      };

      return await typedClient.appointment.findFirst({
        where: { id: appointmentId, ...(scope.clinicId ? { clinicId: scope.clinicId } : {}) },
        select: {
          id: true,
          clinicId: true,
          status: true,
          type: true,
          locationId: true,
          patientId: true,
        },
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

  private summarizeTreatmentPlan(plan?: TreatmentPlanDto): string {
    if (!plan) {
      return '';
    }

    const parts = [
      plan.category,
      plan.treatmentType,
      plan.subProcedure,
      plan.diagnosis,
      plan.treatment,
      plan.followUp,
      ...(plan.recommendations || []),
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

    return parts.join(' | ');
  }
}
