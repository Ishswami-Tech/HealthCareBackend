import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { AppointmentQueueService } from '@infrastructure/queue';
import { CacheService } from '@infrastructure/cache';
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
} from '@core/types/appointment.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
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

interface QueueRecord {
  id: string;
  appointmentId: string;
  queueNumber: number;
  status: string;
  appointment?:
    | {
        id: string;
        patient?: { user?: { name: string } | undefined } | undefined;
        doctor?: { user?: { name: string } | undefined } | undefined;
      }
    | undefined;
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

  /**
   * Public API: Check-in for appointments
   * Validates appointment type and routes to type-specific handler
   * @param appointmentId - The appointment ID
   * @param userId - The user ID performing check-in
   * @returns Check-in result
   */
  async checkIn(appointmentId: string, userId: string): Promise<CheckInResult> {
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
        return this.checkInInPerson(appointment, userId);
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
    userId: string
  ): Promise<CheckInResult> {
    try {
      // No runtime type check needed - TypeScript guarantees it's IN_PERSON
      // locationId is guaranteed to be string (non-null)

      // Check if already checked in (placeholder - would check database)
      // const existingCheckIn = await this.getExistingCheckIn(appointmentId);
      // if (existingCheckIn) {
      //   throw new BadRequestException('Appointment already checked in');
      // }

      // Perform check-in - locationId is guaranteed to be string
      const checkInData: CheckInData = {
        appointmentId: appointment.id,
        userId,
        checkInMethod: 'manual',
        timestamp: new Date().toISOString(),
        locationId: appointment.locationId, // Type-safe: guaranteed non-null
      };

      const result: CheckInResult = {
        success: true,
        appointmentId: appointment.id,
        message: 'Check-in successful',
        checkedInAt: checkInData.timestamp,
      };

      // Add to queue if needed (only for IN_PERSON appointments)
      // TypeScript knows appointment is InPersonAppointment here
      if ((appointment as { domain?: string }).domain === 'healthcare') {
        const queuePosition = await this.addToQueue(
          appointment.id,
          appointment.doctorId,
          appointment.locationId, // Type-safe: guaranteed non-null
          (appointment as { domain?: string }).domain || 'healthcare',
          appointment.patientId || '', // Fix: provide default
          appointment.clinicId || '' // Fix: provide default
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in successful',
        'CheckInService.checkInInPerson',
        {
          appointmentId: appointment.id,
          userId,
          locationId: appointment.locationId,
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

      // Get checked-in appointments from database (placeholder implementation)
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
        `Failed to get checked-in appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
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
   * TypeScript prevents calling this with VIDEO_CALL or HOME_VISIT
   * @param appointment - InPersonAppointment (type-narrowed)
   * @param clinicId - The clinic ID
   * @returns Check-in result
   */
  private processCheckInInPerson(
    appointment: InPersonAppointment,
    clinicId: string
  ): CheckInResult {
    try {
      // No runtime type check needed - TypeScript guarantees it's IN_PERSON
      // locationId is guaranteed to be string (non-null)

      // Process the check-in - locationId is guaranteed to be string
      const result: CheckInResult = {
        success: true,
        appointmentId: appointment.id,
        message: 'Check-in successful',
        checkedInAt: new Date().toISOString(),
      };

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'QR check-in successful',
        'CheckInService.processCheckInInPerson',
        {
          appointmentId: appointment.id,
          clinicId,
          locationId: appointment.locationId, // Type-safe: guaranteed non-null
        }
      );

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process QR check-in: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

      // Get queue position from database (placeholder implementation)
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
      // Validate appointment is checked in
      const checkIn = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkIn: {
              findFirst: <T>(args: T) => Promise<{ id: string } | null>;
            };
          }
        ).checkIn.findFirst({
          where: {
            appointmentId,
          },
          select: {
            id: true,
          },
        } as never);
      });

      if (!checkIn) {
        throw new BadRequestException(
          'Appointment must be checked in before starting consultation'
        );
      }

      // Start consultation
      const result = await this.performConsultationStart(appointmentId, clinicId);

      // Remove from queue
      await this.removeFromQueue(appointmentId, clinicId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Consultation started successfully',
        'CheckInService',
        { appointmentId, clinicId, responseTime: Date.now() - startTime }
      );

      return result;
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

      // Get active queue from database (placeholder implementation)
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
      await this.validateAppointmentOrder(appointmentOrder, clinicId);

      // Reorder queue in database (placeholder implementation)
      await this.performQueueReorder(clinicId, appointmentOrder);

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
        queue: queue as AppointmentQueuePosition[],
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

  // Helper methods (placeholder implementations that would integrate with actual database)
  private validateAppointment(appointmentId: string, userId: string): Promise<CheckInAppointment> {
    // This would integrate with the actual appointment service
    // For now, return mock data
    return Promise.resolve({
      id: appointmentId,
      patientId: userId,
      doctorId: 'doc-1',
      locationId: 'loc-1',
      type: AppointmentType.IN_PERSON,
      status: AppointmentStatus.CONFIRMED,
      domain: 'healthcare',
    });
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
      domain: 'healthcare',
    };
  }

  private async addToQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    domain: string,
    patientId: string, // Add argument
    clinicId: string // Add argument
  ): Promise<AppointmentQueuePosition> {
    await this.appointmentQueueService.checkIn(
      {
        appointmentId,
        doctorId,
        patientId,
        clinicId,
        locationId,
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
    // This would integrate with the actual appointment service
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Updated appointment ${appointmentId} status to ${status}`,
      'CheckInService'
    );
  }

  private performConsultationStart(_appointmentId: string, _clinicId: string): Promise<unknown> {
    // This would integrate with the actual consultation service
    // For now, return mock result
    return Promise.resolve({
      success: true,
      appointmentId: _appointmentId,
      consultationStartedAt: new Date().toISOString(),
      message: 'Consultation started',
    });
  }

  private async removeFromQueue(appointmentId: string, clinicId: string): Promise<void> {
    // We need doctorId to remove from queue.
    // We might need to fetch appointment to get doctorId if not passed.
    // For now, let's try to find appointment or assume we can't easily remove without doctorId.
    // But wait, CheckInService.startConsultation calls this.
    // StartConsultation logic should handle queue update (IN_PROGRESS).
    // So explicit removal might not be needed if startConsultation does it.
    // However, if we MUST remove, we need doctorId.

    // I will call appointmentQueueService.removePatientFromQueue if I can get doctorId.
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (appointment && appointment.doctorId) {
      await this.appointmentQueueService.removePatientFromQueue(
        appointmentId,
        appointment.doctorId,
        clinicId,
        'healthcare'
      ); // hardcoded domain or fetch?
    }
  }

  private fetchCheckedInAppointments(_clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual database
    // For now, return mock data
    return Promise.resolve([
      {
        id: 'app-1',
        patientName: 'John Doe',
        doctorName: 'Dr. Smith',
        checkInTime: new Date().toISOString(),
        status: 'CHECKED_IN',
      },
    ]);
  }

  private async fetchQueuePosition(
    appointmentId: string,
    clinicId: string
  ): Promise<AppointmentQueuePosition | null> {
    try {
      const pos = await this.appointmentQueueService.getPatientQueuePosition(
        appointmentId,
        clinicId,
        'healthcare'
      ); // defaulting domain
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
      'healthcare'
    );
    return response.queue;
  }

  private async validateAppointmentOrder(
    appointmentOrder: string[],
    clinicId: string
  ): Promise<void> {
    // This would validate that all appointments exist and are checked in
    // For now, just log
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Validating appointment order: ${appointmentOrder.join(', ')} for clinic ${clinicId}`,
      'CheckInService'
    );
  }

  private async performQueueReorder(clinicId: string, appointmentOrder: string[]): Promise<void> {
    // We need doctorId to reorder. But CheckInService.reorderQueue takes only clinicId and list.
    // Assuming list belongs to SAME doctor.
    // We need to find doctorId from one of the appointments or passed in?
    // The plugin interface reorderQueue(clinicId, appointmentOrder) doesn't pass doctorId.
    // This is a limitation.
    // We'll throw error or try to infer.
    // For now, let's assume we can't reorder without doctorId.
    // Or we find doctorId from first appointment.

    if (appointmentOrder.length === 0) return;
    const firstApptId = appointmentOrder[0];
    if (!firstApptId) return;
    const appt = await this.databaseService.findAppointmentByIdSafe(firstApptId);
    if (!appt || !appt.doctorId) throw new Error('Cannot determine doctor for reorder');

    await this.appointmentQueueService.reorderQueue(
      {
        doctorId: appt.doctorId,
        clinicId,
        date: new Date().toISOString().split('T')[0] || '',
        newOrder: appointmentOrder,
      },
      'healthcare'
    );
  }

  private async fetchLocationQueue(locationId: string, clinicId?: string): Promise<unknown[]> {
    // Fetch queue entries for the specific location from database
    try {
      const queueEntries = await this.databaseService.executeHealthcareRead<QueueRecord[]>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            queue: {
              findMany: (args: PrismaDelegateArgs) => Promise<QueueRecord[]>;
            };
          };
          // Query Queue model filtered by locationId
          const queues = await typedClient.queue.findMany({
            where: {
              locationId: locationId,
              ...(clinicId && { clinicId: clinicId }),
              status: { in: ['WAITING', 'IN_PROGRESS'] },
            } as PrismaDelegateArgs,
            include: {
              appointment: {
                include: {
                  patient: {
                    include: {
                      user: {
                        select: { name: true } as PrismaDelegateArgs,
                      } as PrismaDelegateArgs,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                  doctor: {
                    include: {
                      user: {
                        select: { name: true } as PrismaDelegateArgs,
                      } as PrismaDelegateArgs,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
            orderBy: {
              queueNumber: 'asc',
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return queues.map((q: QueueRecord) => ({
            id: q.id,
            appointmentId: q.appointmentId,
            queueNumber: q.queueNumber,
            status: q.status,
            appointment: q.appointment,
          }));
        }
      );

      return queueEntries.map(entry => ({
        appointmentId: entry.appointmentId,
        patientName: entry.appointment?.patient?.user?.name || 'Unknown',
        doctorName: entry.appointment?.doctor?.user?.name || 'Unknown',
        position: entry.queueNumber,
        status: entry.status,
        estimatedWaitTime: entry.queueNumber * 10,
      }));
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
      // Return empty array on error
      return [];
    }
  }

  // =============================================
  // AYURVEDIC-SPECIFIC CHECK-IN METHODS
  // =============================================

  /**
   * Process Ayurvedic therapy check-in with location validation
   */
  async processAyurvedicCheckIn(
    appointmentId: string,
    clinicId: string,
    checkInData: CheckInData
  ): Promise<CheckInResult> {
    const startTime = Date.now();

    try {
      // Validate appointment exists and belongs to clinic
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);

      // Check if it's an Ayurvedic appointment type
      const ayurvedicTypes: string[] = [
        'VIDDHAKARMA',
        'AGNIKARMA',
        'PANCHAKARMA',
        'NADI_PARIKSHA',
        'DOSHA_ANALYSIS',
        'SHIRODHARA',
        'VIRECHANA',
        'ABHYANGA',
        'SWEDANA',
        'BASTI',
        'NASYA',
        'RAKTAMOKSHANA',
      ];

      if (!ayurvedicTypes.includes(appointment.type)) {
        throw new BadRequestException('This is not an Ayurvedic appointment');
      }

      // Validate location if coordinates provided
      if (checkInData.coordinates) {
        const isValidLocation = await this.validateAyurvedicLocation(
          checkInData.coordinates,
          checkInData.locationId,
          clinicId
        );

        if (!isValidLocation) {
          throw new BadRequestException(
            'Patient is not within the required radius of the therapy location'
          );
        }
      }

      // Process the check-in
      const result: CheckInResult = {
        success: true,
        appointmentId: checkInData.appointmentId,
        message: 'Check-in successful',
        checkedInAt: checkInData.timestamp,
      };

      // Add to therapy-specific queue if needed
      if (appointment.domain === 'healthcare') {
        const queuePosition = await this.addToTherapyQueue(
          appointmentId,
          appointment.doctorId,
          appointment.locationId,
          appointment.type
        );
        result.queuePosition = queuePosition.position;
        result.estimatedWaitTime = queuePosition.estimatedWaitTime;
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Ayurvedic check-in successful',
        'CheckInService',
        {
          appointmentId,
          clinicId,
          therapyType: appointment.type,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process Ayurvedic check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
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

  /**
   * Get therapy-specific queue for Ayurvedic appointments
   */
  async getTherapyQueue(therapyType: string, clinicId: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue:${therapyType}:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get therapy queue from database (placeholder implementation)
      const queue = await this.fetchTherapyQueue(therapyType, clinicId);

      const result = {
        therapyType,
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
        'Therapy queue retrieved successfully',
        'CheckInService',
        {
          therapyType,
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
        `Failed to get therapy queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          therapyType,
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Validate Ayurvedic therapy location
   */
  private validateAyurvedicLocation(
    _patientCoords: { lat: number; lng: number },
    _locationId: string,
    _clinicId: string
  ): Promise<boolean> {
    // This would integrate with the actual location service
    // For now, return mock validation
    return Promise.resolve(true);
  }

  /**
   * Add to therapy-specific queue
   */
  private addToTherapyQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    _therapyType: string
  ): Promise<AppointmentQueuePosition> {
    // This would integrate with the actual therapy queue service
    // For now, return mock queue position
    return Promise.resolve({
      position: 1,
      totalInQueue: 3,
      estimatedWaitTime: 20,
      doctorId,
      locationId,
    });
  }

  /**
   * Fetch therapy-specific queue
   */
  private fetchTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown[]> {
    // This would integrate with the actual therapy queue service
    // For now, return mock data
    return Promise.resolve([
      {
        appointmentId: 'app-1',
        patientName: 'John Doe',
        therapyType,
        position: 1,
        estimatedWaitTime: 15,
      },
    ]);
  }

  /**
   * Verify check-in
   */
  verifyCheckIn(
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

    try {
      // This would implement check-in verification logic
      // For now, return a placeholder response
      const result = {
        success: true,
        checkInId,
        verifiedBy,
        verifiedAt: new Date().toISOString(),
        message: 'Check-in verified successfully',
      };

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

      return Promise.resolve(result);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify check-in: ${_error instanceof Error ? _error.message : String(_error)}`,
        'CheckInService',
        {
          checkInId,
          verifiedBy,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
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
