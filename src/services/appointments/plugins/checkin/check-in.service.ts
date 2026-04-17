import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  NotImplementedException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { AppointmentQueueService } from '@infrastructure/queue';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import { AppointmentType, AppointmentStatus } from '@core/types/enums.types';
import {
  isVideoCallAppointment,
  isInPersonAppointment,
} from '@core/types/appointment-guards.types';
import type { InPersonAppointment } from '@core/types/appointment.types';
import type { AppointmentBase, Doctor, PatientBase, Clinic } from '@core/types/database.types';
import type { ClinicLocation } from '@core/types/clinic.types';
import type {
  CheckInData,
  CheckInResult,
  AppointmentQueuePosition,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  LocationQueueResponse,
  QueueEntryData,
} from '@core/types/appointment.types';
type Appointment = AppointmentBase;
type Patient = PatientBase;

// Re-export types from centralized location for backward compatibility
export type {
  DeviceInfo,
  CheckInData,
  CheckInResult,
  AppointmentQueuePosition as QueuePosition,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  QueueStatsResponse,
  LocationQueueResponse,
} from '@core/types/appointment.types';
export type { ClinicLocation } from '@core/types/clinic.types';

/**
 * Appointment with relations for check-in service
 * Extends AppointmentBase with related entities
 */
export interface AppointmentWithRelations extends Appointment {
  doctor: Doctor;
  patient: Patient;
  clinic: Clinic;
  location: ClinicLocation;
}

interface QueueReorderContext {
  doctorId: string;
  date: string;
}

interface CheckInVerificationRecord {
  id: string;
  appointmentId: string;
  locationId: string;
  checkedInAt: Date;
  isVerified: boolean;
  verifiedBy: string | null;
  notes: string | null;
  appointment?: { id: string; clinicId: string } | null;
  location?: { clinicId: string } | null;
}

@Injectable()
export class CheckInService {
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes
  private readonly QUEUE_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService
  ) {}

  private async ensureActiveInPersonCoverage(appointment: {
    id: string;
    clinicId?: string | null;
    subscriptionId?: string | null;
    isSubscriptionBased?: boolean | null;
  }): Promise<void> {
    if (!appointment.subscriptionId || !appointment.isSubscriptionBased) {
      throw new BadRequestException(
        'This in-person appointment is not linked to an active subscription'
      );
    }

    const subscription = await this.databaseService.findSubscriptionByIdSafe(
      appointment.subscriptionId
    );
    if (!subscription || subscription.clinicId !== appointment.clinicId) {
      throw new BadRequestException('Linked subscription was not found for this appointment');
    }

    if (String(subscription.status) !== 'ACTIVE' && String(subscription.status) !== 'TRIALING') {
      throw new BadRequestException('Linked subscription is no longer active');
    }

    if (subscription.currentPeriodEnd < new Date()) {
      throw new BadRequestException('Linked subscription coverage period has ended');
    }
  }

  /**
   * Public API: Check-in for appointments
   * Validates appointment type and routes to type-specific handler
   * @param appointmentId - The appointment ID
   * @param userId - The user ID performing check-in
   * @returns Check-in result
   */
  async checkIn(appointmentId: string, userId: string, priority?: string): Promise<CheckInResult> {
    try {
      // Validate appointment exists and belongs to user
      const appointment = await this.validateAppointment(appointmentId, userId);

      // Runtime validation at boundary - route to type-specific handler
      if (isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'Video appointments cannot be checked in at physical locations. Use virtual check-in through the video consultation interface.'
        );
      }

      if (isInPersonAppointment(appointment)) {
        // Type narrowed - cast to InPersonAppointment for type safety
        return this.checkInInPerson(appointment, userId, priority);
      }

      throw new BadRequestException('Unsupported appointment type for physical check-in');
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Check-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CheckInService.checkIn',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Strict type-safe check-in for IN_PERSON appointments only
   * TypeScript prevents calling this with VIDEO_CALL or HOME_VISIT
   * @param appointment - InPersonAppointment (type-narrowed)
   * @param userId - The user ID performing check-in
   * @returns Check-in result
   */
  private async checkInInPerson(
    appointment: InPersonAppointment,
    userId: string,
    priority?: string
  ): Promise<CheckInResult> {
    try {
      // No runtime type check needed - TypeScript guarantees it's IN_PERSON
      // locationId is guaranteed to be string (non-null)
      const now = new Date();
      const clinicId = appointment.clinicId || '';

      await this.ensureActiveInPersonCoverage(appointment);

      if (String(appointment.status) === String(AppointmentStatus.CONFIRMED)) {
        throw new BadRequestException('Appointment arrival is already confirmed');
      }

      // 2. Confirm the appointment and record clinic arrival
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            appointment: {
              update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
            };
            checkIn: {
              findFirst: (args: {
                where: { appointmentId: string; clinicId: string };
              }) => Promise<{ id: string } | null>;
              create: (args: {
                data: {
                  appointmentId: string;
                  locationId: string;
                  patientId: string;
                  clinicId: string;
                  checkedInAt: Date;
                  coordinates?: Record<string, number> | null;
                  deviceInfo?: Record<string, unknown> | null;
                  isVerified: boolean;
                  verifiedBy?: string | null;
                  notes?: string | null;
                };
              }) => Promise<unknown>;
            };
          };
          const existingCheckIn = await typedClient.checkIn.findFirst({
            where: { appointmentId: appointment.id, clinicId },
          });
          if (existingCheckIn) {
            throw new BadRequestException('Appointment arrival is already confirmed');
          }

          await typedClient.appointment.update({
            where: { id: appointment.id },
            data: {
              status: 'CONFIRMED',
              checkedInAt: now,
              updatedAt: now,
            },
          });

          return await typedClient.checkIn.create({
            data: {
              appointmentId: appointment.id,
              locationId: appointment.locationId,
              patientId: appointment.patientId,
              clinicId,
              checkedInAt: now,
              isVerified: false,
              verifiedBy: null,
              notes: 'Manual receptionist check-in',
            },
          });
        },
        {
          userId,
          clinicId,
          resourceType: 'APPOINTMENT',
          operation: 'UPDATE',
          resourceId: appointment.id,
          userRole: 'patient',
          details: { status: 'CONFIRMED', checkInMethod: 'manual' },
        }
      );

      // 3. Build the result
      const result: CheckInResult = {
        success: true,
        appointmentId: appointment.id,
        message: 'Check-in confirmed successfully',
        checkedInAt: now.toISOString(),
      };

      // 4. Add to queue for IN_PERSON appointments
      try {
        const queuePosition = await this.addToQueue(
          appointment.id,
          appointment.doctorId,
          appointment.locationId, // Type-safe: guaranteed non-null
          (appointment as { domain?: string }).domain || 'clinic',
          appointment.patientId || '',
          clinicId,
          priority
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      } catch (queueError) {
        // Queue insertion failure should not fail the check-in itself
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Queue insertion failed after manual check-in: ${queueError instanceof Error ? queueError.message : 'Unknown error'}`,
          'CheckInService.checkInInPerson',
          {
            appointmentId: appointment.id,
            clinicId,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          }
        );
      }

      // 5. Invalidate relevant cache entries
      void this.cacheService.del(`appointment:${appointment.id}`);
      void this.cacheService.del(`queue:location:${appointment.locationId}`);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Manual check-in successful (appointment confirmed, queue position assigned)',
        'CheckInService.checkInInPerson',
        {
          appointmentId: appointment.id,
          userId,
          locationId: appointment.locationId,
          queuePosition: result.queuePosition,
        }
      );

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to check in in-person appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CheckInService.checkInInPerson',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId: appointment.id,
          userId,
        }
      );
      throw error;
    }
  }

  async getCheckedInAppointments(clinicId: string): Promise<CheckedInAppointmentsResponse> {
    const startTime = Date.now();
    const cacheKey = `checkins:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as CheckedInAppointmentsResponse;
      }

      const appointments = await this.fetchCheckedInAppointments(clinicId);

      const result: CheckedInAppointmentsResponse = {
        appointments: appointments as CheckInAppointment[],
        clinicId,
        total: appointments.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.CHECKIN_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Checked-in appointments retrieved successfully',
        'CheckInService',
        {
          clinicId,
          count: appointments.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get arrived appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Public API: Process check-in via QR code
   * Validates appointment type and routes to type-specific handler
   * @param appointmentId - The appointment ID
   * @param clinicId - The clinic ID
   * @returns Check-in result
   */
  async processCheckIn(appointmentId: string, clinicId: string): Promise<unknown> {
    try {
      // Validate appointment exists and belongs to clinic
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);

      // Runtime validation at boundary - route to type-specific handler
      if (isVideoCallAppointment(appointment)) {
        throw new BadRequestException(
          'Video appointments cannot be checked in using QR codes. Use virtual check-in through the video consultation interface.'
        );
      }

      if (isInPersonAppointment(appointment)) {
        // Type narrowed - cast to InPersonAppointment for type safety
        return Promise.resolve(this.processCheckInInPerson(appointment, clinicId));
      }

      throw new BadRequestException('Unsupported appointment type for QR check-in');
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `QR check-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CheckInService.processCheckIn',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId,
          clinicId,
        }
      );
      throw error;
    }
  }

  /**
   * Strict type-safe QR check-in for IN_PERSON appointments only
   * Updates appointment status in DB and adds to queue.
   * @param appointment - InPersonAppointment (type-narrowed)
   * @param clinicId - The clinic ID
   * @returns Check-in result
   */
  private async processCheckInInPerson(
    appointment: InPersonAppointment,
    clinicId: string
  ): Promise<CheckInResult> {
    try {
      const now = new Date();

      // 1. Confirm the appointment and record clinic arrival
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            appointment: {
              update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
            };
            checkIn: {
              findFirst: (args: {
                where: { appointmentId: string; clinicId: string };
              }) => Promise<{ id: string } | null>;
              create: (args: {
                data: {
                  appointmentId: string;
                  locationId: string;
                  patientId: string;
                  clinicId: string;
                  checkedInAt: Date;
                  coordinates?: Record<string, number> | null;
                  deviceInfo?: Record<string, unknown> | null;
                  isVerified: boolean;
                  verifiedBy?: string | null;
                  notes?: string | null;
                };
              }) => Promise<unknown>;
            };
          };
          const existingCheckIn = await typedClient.checkIn.findFirst({
            where: { appointmentId: appointment.id, clinicId },
          });
          if (existingCheckIn) {
            throw new BadRequestException('Appointment arrival is already confirmed');
          }

          await typedClient.appointment.update({
            where: { id: appointment.id },
            data: {
              status: 'CONFIRMED',
              checkedInAt: now,
              updatedAt: now,
            },
          });

          return await typedClient.checkIn.create({
            data: {
              appointmentId: appointment.id,
              locationId: appointment.locationId,
              patientId: appointment.patientId,
              clinicId,
              checkedInAt: now,
              isVerified: false,
              verifiedBy: null,
              notes: 'Manual receptionist QR check-in',
            },
          });
        },
        {
          userId: 'system',
          clinicId,
          resourceType: 'APPOINTMENT',
          operation: 'UPDATE',
          resourceId: appointment.id,
          userRole: 'system',
          details: { status: 'CONFIRMED' },
        }
      );

      // 2. Build the result
      const result: CheckInResult = {
        success: true,
        appointmentId: appointment.id,
        message: 'Check-in confirmed successfully',
        checkedInAt: now.toISOString(),
      };

      // 3. Add to queue for IN_PERSON appointments
      try {
        const queuePosition = await this.addToQueue(
          appointment.id,
          appointment.doctorId,
          appointment.locationId,
          (appointment as { domain?: string }).domain || 'clinic',
          appointment.patientId || '',
          clinicId
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      } catch (queueError) {
        // Queue insertion failure should not fail the check-in itself
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Queue insertion failed after check-in: ${queueError instanceof Error ? queueError.message : 'Unknown error'}`,
          'CheckInService.processCheckInInPerson',
          {
            appointmentId: appointment.id,
            clinicId,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          }
        );
      }

      // 4. Invalidate relevant cache entries
      void this.cacheService.del(`appointment:${appointment.id}`);
      void this.cacheService.del(`queue:location:${appointment.locationId}`);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in successful (appointment confirmed, queue position assigned)',
        'CheckInService.processCheckInInPerson',
        {
          appointmentId: appointment.id,
          clinicId,
          locationId: appointment.locationId,
          queuePosition: result.queuePosition,
        }
      );

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process check-in: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CheckInService.processCheckInInPerson',
        {
          error: error instanceof Error ? error.message : String(error),
          appointmentId: appointment.id,
          clinicId,
        }
      );
      throw error;
    }
  }

  async getPatientQueuePosition(appointmentId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `queue:position:${appointmentId}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Resolve the queue position from the active queue cache
      const queuePosition = await this.fetchQueuePosition(appointmentId, clinicId);

      if (!queuePosition) {
        throw new NotFoundException('Patient not found in queue');
      }

      const result = {
        appointmentId,
        clinicId,
        ...queuePosition,
        retrievedAt: new Date().toISOString(),
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved successfully',
        'CheckInService',
        {
          appointmentId,
          clinicId,
          position: queuePosition.position,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startConsultation(appointmentId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);
      if (!appointment.doctorId) {
        throw new BadRequestException('Appointment is missing doctor assignment');
      }

      const currentStatus = String(appointment.status || '').toUpperCase();
      if (currentStatus !== String(AppointmentStatus.CONFIRMED)) {
        throw new BadRequestException('Appointment must be confirmed before starting consultation');
      }

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const appointmentDelegate = client['appointment'] as {
            update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
          };
          return await appointmentDelegate.update({
            where: { id: appointmentId },
            data: {
              status: 'IN_PROGRESS',
              updatedAt: new Date(),
            },
          });
        },
        {
          userId: appointment.doctorId,
          clinicId,
          resourceType: 'APPOINTMENT',
          operation: 'UPDATE',
          resourceId: appointmentId,
          userRole: 'doctor',
          details: { status: 'IN_PROGRESS' },
        }
      );

      await this.appointmentQueueService.startConsultation(
        appointmentId,
        appointment.doctorId,
        clinicId,
        'clinic'
      );

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Consultation started successfully',
        'CheckInService',
        { appointmentId, clinicId, responseTime: Date.now() - startTime }
      );

      return {
        success: true,
        appointmentId,
        clinicId,
        consultationStartedAt: new Date().toISOString(),
        message: 'Consultation started',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          appointmentId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getDoctorActiveQueue(doctorId: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `queue:doctor:${doctorId}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Resolve the active queue from the queue cache
      const queue = await this.fetchDoctorActiveQueue(doctorId, clinicId);

      const result = {
        doctorId,
        clinicId,
        queue,
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor active queue retrieved successfully',
        'CheckInService',
        {
          doctorId,
          clinicId,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor active queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          doctorId,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async reorderQueue(clinicId: string, appointmentOrder: string[]): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Validate all appointments exist and are checked in
      const reorderContext = await this.validateAppointmentOrder(appointmentOrder, clinicId);

      // Reorder the active queue in cache
      await this.performQueueReorder(clinicId, appointmentOrder, reorderContext);

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`queue:doctor:*:${clinicId}`);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue reordered successfully',
        'CheckInService',
        {
          clinicId,
          orderLength: appointmentOrder.length,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Queue reordered successfully' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          clinicId,
          appointmentOrder,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationQueue(locationId: string, clinicId?: string): Promise<LocationQueueResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:location:${locationId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as LocationQueueResponse;
      }

      // Get location queue from database
      const queue = await this.fetchLocationQueue(locationId, clinicId);

      const result: LocationQueueResponse = {
        locationId: locationId,
        queue,
        total: queue.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location queue retrieved successfully',
        'CheckInService',
        {
          locationId,
          clinicId: clinicId || 'unknown',
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          locationId,
          clinicId: clinicId || 'unknown',
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // Helper methods
  private async validateAppointment(
    appointmentId: string,
    userId: string
  ): Promise<CheckInAppointment> {
    // Get appointment from database
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    // Validate appointment belongs to user (userId should match patientId)
    if (appointment.patientId !== userId) {
      throw new ForbiddenException('This appointment does not belong to you');
    }

    // Validate appointment type
    if (isVideoCallAppointment(appointment)) {
      throw new BadRequestException(
        'Video appointments cannot be checked in at physical locations. Use virtual check-in through the video consultation interface.'
      );
    }

    if (!isInPersonAppointment(appointment)) {
      throw new BadRequestException('Unsupported appointment type for physical check-in');
    }

    // Return validated appointment data
    return {
      id: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      locationId: appointment.locationId,
      type: appointment.type as AppointmentType,
      status: appointment.status as AppointmentStatus,
      domain: (appointment as unknown as { domain?: string }).domain || 'clinic',
    };
  }

  private async validateAppointmentForClinic(
    appointmentId: string,
    clinicId: string
  ): Promise<CheckInAppointment> {
    // Get appointment from database
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }

    // Validate clinic matches
    if (appointment.clinicId !== clinicId) {
      throw new ForbiddenException('Appointment does not belong to this clinic');
    }

    // Validate appointment type - VIDEO_CALL cannot be checked in via QR
    if (isVideoCallAppointment(appointment)) {
      throw new BadRequestException(
        'Video appointments cannot be checked in using QR codes. Use virtual check-in through the video consultation interface.'
      );
    }

    // IN_PERSON appointments require locationId - use strict type guard
    if (!isInPersonAppointment(appointment)) {
      throw new BadRequestException('Only in-person appointments can be checked in using QR codes');
    }

    // TypeScript now knows appointment is InPersonAppointment
    // locationId is guaranteed to be string (non-null)

    return {
      id: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      locationId: appointment.locationId,
      type: appointment.type as AppointmentType,
      status: appointment.status as AppointmentStatus,
      domain: 'clinic',
    };
  }

  private async addToQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    domain: string,
    patientId: string, // Add argument
    clinicId: string, // Add argument
    priority?: string
  ): Promise<AppointmentQueuePosition> {
    await this.appointmentQueueService.checkIn(
      {
        appointmentId,
        doctorId,
        patientId,
        clinicId,
        locationId,
        ...(priority !== undefined ? { priority } : {}),
      },
      domain
    );

    // I need to fetch position AFTER checkin.
    // getPatientQueuePosition returns Promise<PatientQueuePositionResponse>
    const pos = await this.appointmentQueueService.getPatientQueuePosition(
      appointmentId,
      clinicId,
      domain
    );

    return {
      position: pos.position,
      totalInQueue: pos.totalInQueue,
      estimatedWaitTime: pos.estimatedWaitTime,
      doctorId,
      locationId,
    };
  }

  private async updateAppointmentStatus(appointmentId: string, status: string): Promise<void> {
    // Log the status transition until the workflow service takes ownership.
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Updated appointment ${appointmentId} status to ${status}`,
      'CheckInService'
    );
  }

  private performConsultationStart(_appointmentId: string, _clinicId: string): Promise<unknown> {
    throw new NotImplementedException(
      'Consultation start helper is not implemented in the appointment check-in plugin'
    );
  }

  private async removeFromQueue(appointmentId: string, clinicId: string): Promise<void> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (appointment && appointment.doctorId) {
      await this.appointmentQueueService.removePatientFromQueue(
        appointmentId,
        appointment.doctorId,
        clinicId,
        'clinic'
      );
    }
  }

  private async fetchCheckedInAppointments(clinicId: string): Promise<unknown[]> {
    const appointments = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        checkIn: {
          findMany: (args: {
            where: { clinicId: string };
            include: {
              appointment: {
                include: {
                  patient: {
                    include: {
                      user: { select: { name: boolean } };
                    };
                  };
                  doctor: {
                    include: {
                      user: { select: { name: boolean } };
                    };
                  };
                };
              };
            };
            orderBy: { checkedInAt: 'desc' };
          }) => Promise<
            Array<{
              id: string;
              appointmentId: string;
              patientId: string;
              clinicId: string;
              locationId: string;
              checkedInAt: Date;
              isVerified: boolean;
              verifiedBy: string | null;
              notes: string | null;
              appointment: {
                id: string;
                doctorId: string;
                patientId: string;
                locationId: string;
                type: string;
                status: string;
                patient: { user?: { name: string | null } | null };
                doctor: { user?: { name: string | null } | null };
              };
            }>
          >;
        };
      };

      return await typedClient.checkIn.findMany({
        where: { clinicId },
        include: {
          appointment: {
            include: {
              patient: {
                include: {
                  user: { select: { name: true } },
                },
              },
              doctor: {
                include: {
                  user: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { checkedInAt: 'desc' },
      });
    });

    return appointments.map(checkIn => ({
      id: checkIn.appointmentId,
      patientId: checkIn.patientId,
      doctorId: checkIn.appointment.doctorId,
      locationId: checkIn.appointment.locationId,
      type: checkIn.appointment.type,
      status: checkIn.appointment.status,
      domain: 'clinic',
      checkedInAt: checkIn.checkedInAt.toISOString(),
      patientName: checkIn.appointment.patient?.user?.name || 'Unknown',
      doctorName: checkIn.appointment.doctor?.user?.name || 'Unknown',
    }));
  }

  private async fetchQueuePosition(
    appointmentId: string,
    clinicId: string
  ): Promise<AppointmentQueuePosition | null> {
    try {
      const pos = await this.appointmentQueueService.getPatientQueuePosition(
        appointmentId,
        clinicId,
        'clinic'
      );
      if (!pos) return null;
      return {
        position: pos.position,
        totalInQueue: pos.totalInQueue,
        estimatedWaitTime: pos.estimatedWaitTime,
        doctorId: pos.doctorId,
        locationId: 'unknown', // limitation of response
      };
    } catch {
      return null;
    }
  }

  private async fetchDoctorActiveQueue(doctorId: string, clinicId: string): Promise<unknown[]> {
    const response = await this.appointmentQueueService.getDoctorQueue(
      doctorId,
      clinicId,
      new Date().toISOString().split('T')[0] || '',
      'clinic'
    );
    return response.queue;
  }

  private async validateAppointmentOrder(
    appointmentOrder: string[],
    clinicId: string
  ): Promise<QueueReorderContext> {
    if (appointmentOrder.length === 0) {
      throw new BadRequestException('Appointment order cannot be empty');
    }

    const appointments = await this.databaseService.executeHealthcareRead(async client => {
      const appointmentDelegate = client['appointment'] as {
        findMany: (args: {
          where: {
            id: { in: string[] };
            clinicId: string;
          };
          select: {
            id: boolean;
            doctorId: boolean;
            date: boolean;
            checkedInAt: boolean;
            status: boolean;
            locationId: boolean;
          };
        }) => Promise<
          Array<{
            id: string;
            doctorId: string;
            date: Date;
            checkedInAt: Date | null;
            status: string;
            locationId: string;
          }>
        >;
      };

      return await appointmentDelegate.findMany({
        where: {
          id: { in: appointmentOrder },
          clinicId,
        },
        select: {
          id: true,
          doctorId: true,
          date: true,
          checkedInAt: true,
          status: true,
          locationId: true,
        },
      });
    });

    if (appointments.length !== appointmentOrder.length) {
      throw new NotFoundException('One or more appointments in the requested order were not found');
    }

    const firstAppointment = appointments[0];
    if (!firstAppointment) {
      throw new BadRequestException('Appointment order cannot be empty');
    }

    const doctorId = firstAppointment.doctorId;
    const queueDate = firstAppointment.date.toISOString().split('T')[0];
    if (!queueDate) {
      throw new BadRequestException('Unable to determine queue date');
    }

    for (const appointment of appointments) {
      if (appointment.doctorId !== doctorId) {
        throw new BadRequestException('All reordered appointments must belong to the same doctor');
      }

      if (appointment.date.toISOString().split('T')[0] !== queueDate) {
        throw new BadRequestException('All reordered appointments must belong to the same date');
      }

      if (!appointment.checkedInAt) {
        throw new BadRequestException('Only checked-in appointments can be reordered');
      }
    }

    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Validated appointment order for clinic ${clinicId}`,
      'CheckInService',
      {
        clinicId,
        doctorId,
        queueDate,
        orderLength: appointmentOrder.length,
      }
    );

    return { doctorId, date: queueDate };
  }

  private async performQueueReorder(
    clinicId: string,
    appointmentOrder: string[],
    context: QueueReorderContext
  ): Promise<void> {
    if (appointmentOrder.length === 0) {
      return;
    }

    await this.appointmentQueueService.reorderQueue(
      {
        doctorId: context.doctorId,
        clinicId,
        date: context.date,
        newOrder: appointmentOrder,
      },
      'clinic'
    );
  }

  private async fetchLocationQueue(
    locationId: string,
    clinicId?: string
  ): Promise<AppointmentQueuePosition[]> {
    if (!clinicId) {
      return [];
    }

    try {
      const queueKeys = await this.cacheService.keys(`queue:*:${clinicId}:*`);
      const queues = await Promise.all(
        queueKeys.map(async key => {
          const [, domain, keyClinicId, doctorId, date] = key.split(':');
          if (!domain || !keyClinicId || !doctorId || !date || keyClinicId !== clinicId) {
            return [] as AppointmentQueuePosition[];
          }

          try {
            const queue = await this.appointmentQueueService.getDoctorQueue(
              doctorId,
              clinicId,
              date,
              domain,
              locationId
            );

            return queue.queue
              .filter((entry: QueueEntryData) => entry.locationId === locationId)
              .map((entry: QueueEntryData) => ({
                doctorId: entry.doctorId,
                locationId: entry.locationId || locationId,
                position: entry.position ?? 0,
                totalInQueue: queue.totalLength,
                estimatedWaitTime: entry.estimatedWaitTime ?? queue.estimatedNextWaitTime,
              }));
          } catch {
            return [];
          }
        })
      );

      return queues.flat();
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to fetch location queue: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInService.fetchLocationQueue',
        {
          locationId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return [];
    }
  }

  // =============================================
  // AYURVEDIC-SPECIFIC CHECK-IN METHODS
  // =============================================

  /**
   * Process Ayurvedic therapy check-in with location validation
   */
  processAyurvedicCheckIn(
    _appointmentId: string,
    _clinicId: string,
    _checkInData: CheckInData
  ): Promise<CheckInResult> {
    throw new NotImplementedException(
      'Ayurvedic check-in queue processing is not implemented in the appointment check-in plugin'
    );
  }

  /**
   * Get therapy-specific queue for Ayurvedic appointments
   */
  getTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown> {
    throw new NotImplementedException(
      `Therapy queue retrieval is not implemented for therapy type ${therapyType} in this plugin`
    );
  }

  /**
   * Validate Ayurvedic therapy location
   */
  private validateAyurvedicLocation(
    _patientCoords: { lat: number; lng: number },
    _locationId: string,
    _clinicId: string
  ): Promise<boolean> {
    throw new NotImplementedException(
      'Ayurvedic location validation is not implemented in the appointment check-in plugin'
    );
  }

  /**
   * Add to therapy-specific queue
   */
  private addToTherapyQueue(
    appointmentId: string,
    _doctorId: string,
    _locationId: string,
    _therapyType: string
  ): Promise<AppointmentQueuePosition> {
    throw new NotImplementedException(
      `Therapy queue insertion is not implemented for appointment ${appointmentId}`
    );
  }

  /**
   * Fetch therapy-specific queue
   */
  private fetchTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown[]> {
    throw new NotImplementedException(
      `Therapy queue fetch is not implemented for therapy type ${therapyType}`
    );
  }

  /**
   * Verify check-in
   */
  async verifyCheckIn(
    checkInId: string,
    verifiedBy: string
  ): Promise<{
    success: boolean;
    checkInId: string;
    verifiedBy: string;
    verifiedAt: string;
    message: string;
  }> {
    const startTime = Date.now();

    const checkIn = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        checkIn: {
          findUnique: (args: {
            where: { id: string };
            include: { appointment: true; location: true };
          }) => Promise<CheckInVerificationRecord | null>;
        };
      };

      return await typedClient.checkIn.findUnique({
        where: { id: checkInId },
        include: { appointment: true, location: true },
      });
    });

    if (!checkIn) {
      throw new NotFoundException(`Check-in ${checkInId} not found`);
    }

    const clinicId = checkIn.appointment?.clinicId || checkIn.location?.clinicId || '';

    return this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as {
          checkIn: {
            update: (args: {
              where: { id: string };
              data: { isVerified: boolean; verifiedBy: string };
            }) => Promise<{
              id: string;
              appointmentId: string;
              locationId: string;
              checkedInAt: Date;
              isVerified: boolean;
              verifiedBy: string | null;
              notes: string | null;
            }>;
          };
        };

        const updated = await typedClient.checkIn.update({
          where: { id: checkInId },
          data: {
            isVerified: true,
            verifiedBy,
          },
        });

        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          'Check-in verified successfully',
          'CheckInService',
          {
            checkInId,
            verifiedBy,
            responseTime: Date.now() - startTime,
          }
        );

        return {
          success: true,
          checkInId: updated.id,
          verifiedBy,
          verifiedAt: new Date().toISOString(),
          message: 'Check-in verified successfully',
        };
      },
      {
        userId: verifiedBy,
        clinicId,
        resourceType: 'CHECK_IN',
        operation: 'UPDATE',
        resourceId: checkInId,
        userRole: 'system',
        details: { verifiedBy },
      }
    );
  }

  /**
   * Get health status of the service
   */
  async getHealthStatus(): Promise<{ status: string; message?: string }> {
    try {
      // Check if we can connect to cache service
      await this.cacheService.get('health-check');

      return {
        status: 'healthy',
        message: 'CheckInService is operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `CheckInService health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
