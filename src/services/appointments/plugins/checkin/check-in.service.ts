import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
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
import type { ProcessCheckInOptions } from '@core/types/appointment.types';
import {
  CheckInLocationService,
  VIDEO_CHECK_IN_REJECTION_MESSAGE,
} from '@services/appointments/plugins/therapy/check-in-location.service';
import type { AppointmentBase, Doctor, PatientBase, Clinic } from '@core/types/database.types';
import type { ClinicLocation } from '@core/types/clinic.types';
import type {
  CheckInResult,
  AppointmentQueuePosition,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  LocationQueueResponse,
  QueueEntryData,
} from '@core/types/appointment.types';
import { formatDateKeyInIST, nowIso } from '../../../../libs/utils/date-time.util';
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
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService,
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocationService: CheckInLocationService
  ) {}

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
        retrievedAt: nowIso(),
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
   * Arrival confirmation for an in-person appointment (reception desk / clinical staff).
   *
   * A thin adapter over `CheckInLocationService.processCheckIn`, the one implementation every
   * check-in path shares: atomic SCHEDULED -> CONFIRMED + CheckIn row, plan coverage, same-IST-day
   * rule, receptionist location rule, and an entry in the doctor's live queue that is verified and
   * repaired on retry. A queue failure surfaces as 503 instead of a 200 without a queue entry, and
   * a repeated call is idempotent (no second CheckIn row).
   *
   * Pass the authenticated `actor` whenever one exists: it drives the ownership / receptionist
   * location checks and decides whether the patient time window applies. A call without an actor
   * is treated like a patient for the window (fail closed) and skips the actor checks.
   *
   * @param appointmentId - The appointment ID
   * @param clinicId - The clinic ID
   * @param actor - The authenticated caller, when known
   * @returns Check-in result
   */
  async processCheckIn(
    appointmentId: string,
    clinicId: string,
    actor?: ProcessCheckInOptions['actor']
  ): Promise<CheckInResult> {
    try {
      // Same authorization the unified check-in applies, in the same order: clinic-scoped read
      // (another clinic's appointment is a 404), patient ownership, no video, receptionist location.
      const appointment = await this.checkInLocationService.getAppointmentForCheckIn(
        appointmentId,
        clinicId,
        actor
      );
      if (!appointment.locationId) {
        throw new BadRequestException('This appointment has no clinic location to check in at');
      }

      const processed = await this.checkInLocationService.processCheckIn(
        {
          appointmentId,
          locationId: appointment.locationId,
          patientId: appointment.patientId,
        },
        clinicId,
        { ...(actor ? { actor } : {}), presence: 'skip' }
      );

      const result: CheckInResult = {
        success: true,
        appointmentId,
        message: 'Check-in confirmed successfully',
        checkedInAt: processed.checkInTime.toISOString(),
      };

      try {
        const position = await this.appointmentQueueService.getPatientQueuePosition(
          appointmentId,
          clinicId,
          'clinic'
        );
        result.queuePosition = position.position;
        result.estimatedWaitTime = position.estimatedWaitTime;
      } catch (positionError) {
        // The position is informational; the arrival and the queue entry are already recorded.
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Queue position lookup failed after check-in: ${positionError instanceof Error ? positionError.message : 'Unknown error'}`,
          'CheckInService.processCheckIn',
          { appointmentId, clinicId }
        );
      }

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Check-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        retrievedAt: nowIso(),
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
    const now = new Date();

    try {
      const appointment = await this.validateAppointmentForClinic(appointmentId, clinicId);
      if (!appointment.doctorId) {
        throw new BadRequestException('Appointment is missing doctor assignment');
      }

      const appointmentRecord = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      const currentStatus = String(
        appointmentRecord?.status || appointment.status || ''
      ).toUpperCase();
      const isArrivalConfirmed = Boolean(appointmentRecord?.checkedInAt);
      if (currentStatus !== String(AppointmentStatus.CONFIRMED) || !isArrivalConfirmed) {
        throw new BadRequestException(
          'Appointment must be checked in before starting consultation'
        );
      }

      // Conditional on the state that was just checked: a reschedule (or cancellation) that commits
      // between the check and this write moves the visit out of CONFIRMED/checked-in, and must
      // not be turned into an IN_PROGRESS consultation.
      const started = await this.databaseService.executeHealthcareWrite(
        async client => {
          const appointmentDelegate = client['appointment'] as unknown as {
            updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
          };
          return await appointmentDelegate.updateMany({
            where: {
              id: appointmentId,
              clinicId,
              status: AppointmentStatus.CONFIRMED,
              checkedInAt: { not: null },
            },
            data: {
              status: 'IN_PROGRESS',
              startedAt: now,
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
      if (!started || started.count === 0) {
        throw new ConflictException(
          'The appointment changed while the consultation was starting. Reload and try again.'
        );
      }

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
        consultationStartedAt: nowIso(),
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
        retrievedAt: nowIso(),
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
        retrievedAt: nowIso(),
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

    // Validate appointment type - VIDEO_CALL never takes part in clinic check-in / the queue
    if (isVideoCallAppointment(appointment)) {
      throw new BadRequestException(VIDEO_CHECK_IN_REJECTION_MESSAGE);
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
    priority?: string,
    appointmentType?: string
  ): Promise<AppointmentQueuePosition> {
    await this.appointmentQueueService.checkIn(
      {
        appointmentId,
        doctorId,
        patientId,
        clinicId,
        locationId,
        ...(appointmentType ? { appointmentType } : {}),
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

  private performConsultationStart(appointmentId: string, clinicId: string): Promise<unknown> {
    return this.startConsultation(appointmentId, clinicId);
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
              location: {
                select: {
                  locationName: boolean;
                };
              };
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
                  payment: {
                    select: {
                      status: boolean;
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
              location?: { locationName?: string | null } | null;
              appointment: {
                id: string;
                doctorId: string;
                patientId: string;
                locationId: string;
                date: Date;
                time: string;
                type: string;
                status: string;
                payment?: { status?: string | null } | null;
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
          location: {
            select: {
              locationName: true,
            },
          },
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
              payment: {
                select: {
                  status: true,
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
      appointmentDate: checkIn.appointment.date.toISOString(),
      appointmentTime: checkIn.appointment.time,
      type: checkIn.appointment.type,
      status: checkIn.appointment.status,
      domain: 'clinic',
      checkedInAt: checkIn.checkedInAt.toISOString(),
      locationName: checkIn.location?.locationName || 'Unknown location',
      patientName: checkIn.appointment.patient?.user?.name || 'Unknown',
      doctorName: checkIn.appointment.doctor?.user?.name || 'Unknown',
      checkInMethod: /qr check-in/i.test(checkIn.notes || '') ? 'QR' : 'MANUAL',
      paymentStatus: checkIn.appointment.payment?.status || 'N_A',
      notes: checkIn.notes,
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
      formatDateKeyInIST(new Date()),
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
      const appointmentDelegate = client['appointment'] as unknown as {
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
    const queueDate = formatDateKeyInIST(firstAppointment.date);
    if (!queueDate) {
      throw new BadRequestException('Unable to determine queue date');
    }

    for (const appointment of appointments) {
      if (appointment.doctorId !== doctorId) {
        throw new BadRequestException('All reordered appointments must belong to the same doctor');
      }

      if (formatDateKeyInIST(appointment.date) !== queueDate) {
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
   * Get therapy-specific queue for Ayurvedic appointments
   */
  getTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown> {
    return this.fetchTherapyQueue(therapyType, _clinicId).then(queue => ({
      therapyType,
      clinicId: _clinicId,
      queue,
      total: queue.length,
      retrievedAt: nowIso(),
    }));
  }

  /**
   * Add to therapy-specific queue
   */
  private addToTherapyQueue(
    appointmentId: string,
    doctorId: string,
    locationId: string,
    therapyType: string,
    patientId: string,
    clinicId: string
  ): Promise<AppointmentQueuePosition> {
    return this.addToQueue(
      appointmentId,
      doctorId,
      locationId,
      'clinic',
      patientId,
      clinicId,
      undefined,
      therapyType
    );
  }

  /**
   * Fetch therapy-specific queue
   */
  private fetchTherapyQueue(therapyType: string, _clinicId: string): Promise<unknown[]> {
    const normalizedTherapyType = String(therapyType || '')
      .trim()
      .toUpperCase();
    return this.databaseService.executeHealthcareRead(async _client => {
      const queueKeys = await this.cacheService.keys(`queue:clinic:${_clinicId}:*`);
      const results: unknown[] = [];

      for (const queueKey of queueKeys) {
        const entries = await this.cacheService.lRange(queueKey, 0, -1);
        const doctorId = queueKey.split(':')[3] || '';

        for (const entry of entries) {
          try {
            const parsed = JSON.parse(entry) as {
              appointmentId?: string;
              patientId?: string;
              doctorId?: string;
              locationId?: string;
              status?: string;
              checkedInAt?: string;
              displayLabel?: string;
              type?: string;
              treatmentType?: string;
              queueCategory?: string;
              position?: number;
              estimatedWaitTime?: number;
            };

            const entryTherapyType = String(
              parsed.treatmentType || parsed.type || parsed.displayLabel || ''
            )
              .trim()
              .toUpperCase();

            if (normalizedTherapyType && entryTherapyType !== normalizedTherapyType) {
              continue;
            }

            results.push({
              appointmentId: parsed.appointmentId,
              patientId: parsed.patientId,
              doctorId: parsed.doctorId || doctorId,
              locationId: parsed.locationId,
              status: parsed.status,
              checkedInAt: parsed.checkedInAt,
              displayLabel: parsed.displayLabel,
              treatmentType: parsed.treatmentType || parsed.type || therapyType,
              queueCategory: parsed.queueCategory,
              position: parsed.position,
              estimatedWaitTime: parsed.estimatedWaitTime,
            });
          } catch {
            continue;
          }
        }
      }

      return results;
    });
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
          verifiedAt: nowIso(),
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
