import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { startOfIstDay, endOfIstDay } from '@utils/clock.util';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LocationCacheService } from '@infrastructure/cache/services/location-cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import { AppointmentQueueService } from '@infrastructure/queue';
import type { ClinicLocationResponseDto } from '@core/types/clinic.types';
import type {
  CheckInLocation,
  CheckIn,
  CreateCheckInLocationDto,
  UpdateCheckInLocationDto,
  ProcessCheckInDto,
  ProcessCheckInOptions,
  CheckInPresenceMode,
  VerifyCheckInDto,
  CheckInValidation,
} from '@core/types/appointment.types';
import { Role } from '@core/types/enums.types';
import { isVideoCallAppointmentType } from '@core/types/appointment-guards.types';
import {
  isAppointmentOwnedByPatientUser,
  isReceptionistAssignedToAppointmentLocation,
} from '../../core/appointment-access.util';
import {
  CHECK_IN_TIME_UNKNOWN_MESSAGE,
  FORCE_CHECK_IN_MAX_DISTANCE_METERS,
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  assessCheckInTiming,
  createCheckInNotTodayException,
  createCheckInWindowClosedException,
  createOutsideClinicRadiusException,
  haversineDistanceMeters,
  isWithinRadiusMeters,
  parseGeoCoordinates,
  parseStoredGeofenceCenter,
  resolveForceCheckInRadiusMeters,
  type GeoCoordinates,
} from '../../core/check-in-presence.util';

export {
  FORCE_CHECK_IN_MAX_DISTANCE_METERS,
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
};

/** Shown when a check-in entry point is used for a video visit. */
export const VIDEO_CHECK_IN_REJECTION_MESSAGE = 'Video appointments do not use clinic check-in';

/** Statuses an arrival can still be recorded from. */
const CHECK_IN_ELIGIBLE_STATUSES: readonly string[] = ['SCHEDULED', 'CONFIRMED'];

/** Statuses after which an appointment can never be checked in. */
const CHECK_IN_CLOSED_STATUSES: ReadonlySet<string> = new Set<string>([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'DISCHARGED',
  'TRANSFERRED',
]);

/**
 * Roles that check a patient in on the patient's behalf. They never prove presence and, unlike a
 * patient, may check in outside the 30 min / 3 h window (but never another day's appointment).
 */
const STAFF_CHECK_IN_ROLES: ReadonlySet<string> = new Set<string>([
  String(Role.RECEPTIONIST),
  String(Role.DOCTOR),
  String(Role.ASSISTANT_DOCTOR),
  String(Role.NURSE),
  String(Role.CLINIC_ADMIN),
  String(Role.SUPER_ADMIN),
]);

/**
 * `AppointmentQueueService.checkIn` throws a plain Error ('Appointment arrival is already
 * confirmed') when the entry is already in the live queue. The check-in specs run the real queue
 * service to keep this marker honest.
 */
const QUEUE_ENTRY_EXISTS_MARKER = 'already confirmed';

/** The per-appointment queue lock: short TTL, bounded wait so a double click does not 503. */
const QUEUE_LOCK_TTL_SECONDS = 10;
const QUEUE_LOCK_ATTEMPTS = 6;
const QUEUE_LOCK_RETRY_DELAY_MS = 50;

/** The appointment columns check-in needs (read fresh, never from the detail cache). */
interface CheckInAppointmentRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  userId?: string | null;
  familyMemberId?: string | null;
  type: string;
  status: string;
  date?: Date | string | null;
  time?: string | null;
  locationId?: string | null;
  checkedInAt?: Date | null;
  subscriptionId?: string | null;
  isSubscriptionBased?: boolean | null;
}

/**
 * A processed check-in. `queueRepaired` is true when this call only re-added an arrival that was
 * already recorded to the doctor's live queue (a previous attempt committed the arrival but the
 * queue push failed), so callers can still emit the events that attempt never reached.
 */
export interface ProcessedCheckIn extends CheckIn {
  queueRepaired?: boolean;
}

/** What the check-in entry points (controllers) need to know about the appointment they act on. */
export interface CheckInAppointmentSummary {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  type: string;
  status: string;
  locationId: string | null;
  checkedInAt: Date | null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

/**
 * CacheService.get hands back either the JSON string that was stored or the value already
 * parsed, depending on the provider. Both are accepted; a string that is not JSON throws.
 */
function readCachedJson(cached: unknown): unknown {
  return typeof cached === 'string' ? JSON.parse(cached) : cached;
}

function isCachedLocation(value: unknown): value is CheckInLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { id?: unknown; clinicId?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.clinicId === 'string';
}

interface CheckInRow {
  id: string;
  appointmentId: string;
  locationId: string;
  checkedInAt: Date;
  isVerified: boolean;
  verifiedBy: string | null;
  coordinates: Record<string, number> | null;
  deviceInfo: Record<string, unknown> | null;
}

interface CheckInTransactionClient {
  appointment: {
    updateMany: <T>(args: T) => Promise<{ count: number }>;
  };
  checkIn: {
    findFirst: <T>(args: T) => Promise<CheckInRow | null>;
    create: <T>(args: T) => Promise<CheckInRow>;
    update: <T>(args: T) => Promise<CheckInRow>;
  };
}

type CheckInClaimOutcome = { claimed: false } | { claimed: true; row: CheckInRow };

@Injectable()
export class CheckInLocationService {
  private readonly LOCATION_CACHE_TTL = 3600; // 1 hour
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly appointmentQueueService: AppointmentQueueService,
    @Optional()
    @Inject(forwardRef(() => LocationCacheService))
    private readonly locationCacheService?: LocationCacheService,
    @Optional()
    @Inject(forwardRef(() => ClinicLocationService))
    private readonly clinicLocationService?: ClinicLocationService
  ) {}

  private async ensureActiveInPersonCoverage(appointment: {
    clinicId?: string | null;
    subscriptionId?: string | null;
    isSubscriptionBased?: boolean | null;
  }): Promise<void> {
    if (!appointment.subscriptionId || !appointment.isSubscriptionBased) {
      throw new BadRequestException(
        'This in-person appointment needs an active plan before check-in'
      );
    }

    const subscription = await this.databaseService.findSubscriptionByIdSafe(
      appointment.subscriptionId
    );
    if (!subscription || subscription.clinicId !== appointment.clinicId) {
      throw new BadRequestException('The active plan for this appointment could not be found');
    }

    if (String(subscription.status) !== 'ACTIVE' && String(subscription.status) !== 'TRIALING') {
      throw new BadRequestException('The active plan for this appointment is no longer valid');
    }

    if (subscription.currentPeriodEnd < new Date()) {
      throw new BadRequestException('The active plan coverage period has ended');
    }
  }

  /**
   * Create a new check-in location
   */
  async createCheckInLocation(data: CreateCheckInLocationDto): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
      // The linked ClinicLocation must belong to the caller's clinic: appointments reference
      // ClinicLocation ids, so linking a foreign one would attach another clinic's location.
      if (data.locationId) {
        await this.assertClinicLocationBelongsToClinic(data.locationId, data.clinicId);
      }

      // Generate QR code (unique identifier)
      const qrCode = this.generateQRCode(data.clinicId, data.locationName);

      // Use executeHealthcareWrite for create with audit logging
      const location = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              checkInLocation: {
                create: <T>(args: T) => Promise<CheckInLocation>;
              };
            }
          ).checkInLocation.create({
            data: {
              clinicId: data.clinicId,
              ...(data.locationId ? { locationId: data.locationId } : {}),
              locationName: data.locationName,
              qrCode,
              coordinates: data.coordinates as never,
              radius: data.radius,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: data.clinicId,
          resourceType: 'CHECK_IN_LOCATION',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { locationName: data.locationName, clinicId: data.clinicId },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);

      // Also invalidate shared location cache if locationId is linked
      if (location.locationId && this.locationCacheService) {
        await this.locationCacheService.invalidateLocation(location.locationId, data.clinicId);
      }

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location created successfully',
        'CheckInLocationService',
        {
          locationId: location.id,
          locationName: data.locationName,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return location;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create check-in location: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw this.mapCheckInLocationWriteError(error);
    }
  }

  private async assertClinicLocationBelongsToClinic(
    locationId: string,
    clinicId: string
  ): Promise<void> {
    const clinicLocation = await this.databaseService.executeHealthcareRead(async client => {
      return await (
        client as unknown as {
          clinicLocation: {
            findFirst: <T>(args: T) => Promise<{ id: string } | null>;
          };
        }
      ).clinicLocation.findFirst({
        where: { id: locationId, clinicId, deletedAt: null },
        select: { id: true },
      } as never);
    });

    if (!clinicLocation) {
      throw new BadRequestException('Clinic location not found for this clinic');
    }
  }

  /**
   * Prisma unique / foreign-key violations (also when DatabaseService wrapped the original
   * error and only kept its message) become 409 / 400 instead of a generic 500. Anything that
   * is already an HTTP exception passes through untouched.
   */
  private mapCheckInLocationWriteError(error: unknown): unknown {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof ForbiddenException
    ) {
      return error;
    }

    const code =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const message = error instanceof Error ? error.message : '';

    if (code === 'P2002' || message.includes('P2002') || message.includes('Unique constraint')) {
      return new ConflictException('A check-in point already exists for this clinic location');
    }
    if (
      code === 'P2003' ||
      message.includes('P2003') ||
      message.includes('Foreign key constraint')
    ) {
      return new BadRequestException('The selected clinic location does not exist');
    }
    return error;
  }

  /**
   * Get all check-in locations for a clinic
   * Note: CheckInLocation is a different model from ClinicLocation
   * This method returns CheckInLocation records, but can use LocationCacheService
   * for related ClinicLocation data if locationId is linked
   */
  async getClinicLocations(clinicId: string, isActive?: boolean): Promise<CheckInLocation[]> {
    const startTime = Date.now();
    const cacheKey = `checkin-locations:clinic:${clinicId}:${isActive ?? 'all'}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached && cached !== '') {
        try {
          const parsed = readCachedJson(cached);
          if (Array.isArray(parsed)) {
            return parsed as CheckInLocation[];
          }
        } catch (parseError) {
          // Invalid cached data, continue to fetch from database
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to parse cached clinic locations: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            'CheckInLocationService',
            { cacheKey }
          );
        }
      }

      // Use executeHealthcareRead for optimized query with caching
      const locations = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findMany: <T>(args: T) => Promise<CheckInLocation[]>;
            };
          }
        ).checkInLocation.findMany({
          where: {
            clinicId,
            ...(isActive !== undefined && { isActive }),
          },
          include: {
            checkIns: {
              take: 10,
              orderBy: { checkedInAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        } as never);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(locations), this.LOCATION_CACHE_TTL);

      // If any CheckInLocation has locationId linking to ClinicLocation, warm the shared cache
      if (this.locationCacheService && this.clinicLocationService) {
        const locationIds = locations
          .map(loc => loc.locationId)
          .filter((id): id is string => Boolean(id));

        if (locationIds.length > 0) {
          // Warm shared cache for linked ClinicLocations
          await this.locationCacheService.warmLocations(
            locationIds,
            async (locationId: string) => {
              return await this.clinicLocationService!.getClinicLocationById(
                locationId,
                false,
                clinicId
              );
            },
            clinicId
          );
        }
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic check-in locations retrieved successfully',
        'CheckInLocationService',
        {
          clinicId,
          count: locations.length,
          responseTime: Date.now() - startTime,
        }
      );

      return locations;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic locations: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get location by ID
   */
  async getLocationById(locationId: string, clinicId?: string): Promise<CheckInLocation> {
    const startTime = Date.now();
    const cacheKey = `checkin-location:id:${clinicId || 'all'}:${locationId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached && cached !== '') {
        try {
          const parsed = readCachedJson(cached);
          if (isCachedLocation(parsed)) {
            return parsed;
          }
        } catch (parseError) {
          // Invalid cached data, continue to fetch from database
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to parse cached location: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            'CheckInLocationService',
            { cacheKey, locationId }
          );
        }
      }

      // Use executeHealthcareRead for optimized query
      const location = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findFirst: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findFirst({
          where: {
            OR: [{ id: locationId }, { locationId }],
            ...(clinicId ? { clinicId } : {}),
          },
        } as never);
      });

      if (!location) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(location), this.LOCATION_CACHE_TTL);

      // If CheckInLocation has locationId linking to ClinicLocation, warm the shared cache
      if (location.locationId && this.locationCacheService && this.clinicLocationService) {
        // Try to get from shared cache first
        const clinicLocation = await this.locationCacheService.getLocation(
          location.locationId,
          false,
          location.clinicId
        );
        if (!clinicLocation) {
          // Cache miss - fetch and populate shared cache
          const fetched = await this.clinicLocationService.getClinicLocationById(
            location.locationId,
            false,
            location.clinicId
          );
          if (fetched) {
            await this.locationCacheService.setLocation(
              location.locationId,
              fetched,
              false,
              location.clinicId
            );
          }
        }
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location retrieved by ID',
        'CheckInLocationService',
        {
          locationId: location.id,
          responseTime: Date.now() - startTime,
        }
      );

      return location;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location by ID: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get location by QR code
   */
  async getLocationByQRCode(qrCode: string, clinicId?: string): Promise<CheckInLocation> {
    const startTime = Date.now();
    const cacheKey = `checkin-location:qr:${clinicId || 'all'}:${qrCode}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached && cached !== '') {
        try {
          const parsed = readCachedJson(cached);
          if (isCachedLocation(parsed) && (!clinicId || parsed.clinicId === clinicId)) {
            return parsed;
          }
        } catch (parseError) {
          // Invalid cached data, continue to fetch from database
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to parse cached location by QR: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            'CheckInLocationService',
            { cacheKey, qrCode }
          );
        }
      }

      // Use executeHealthcareRead for optimized query
      const location = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findFirst: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findFirst({
          where: {
            // Printed codes are typed by hand (often upper-cased by keyboards/inputs).
            qrCode: { equals: qrCode, mode: 'insensitive' },
            ...(clinicId ? { clinicId } : {}),
          },
        } as never);
      });

      if (!location) {
        throw new NotFoundException(`Location with QR code ${qrCode} not found`);
      }

      if (!location.isActive) {
        throw new BadRequestException('This check-in location is not active');
      }

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(location), this.LOCATION_CACHE_TTL);

      // If CheckInLocation has locationId linking to ClinicLocation, warm the shared cache
      if (location.locationId && this.locationCacheService && this.clinicLocationService) {
        // Try to get from shared cache first
        const clinicLocation = await this.locationCacheService.getLocation(
          location.locationId,
          false,
          clinicId || location.clinicId
        );
        if (!clinicLocation) {
          // Cache miss - fetch and populate shared cache
          const fetched = await this.clinicLocationService.getClinicLocationById(
            location.locationId,
            false,
            clinicId || location.clinicId
          );
          if (fetched) {
            await this.locationCacheService.setLocation(
              location.locationId,
              fetched,
              false,
              clinicId || location.clinicId
            );
          }
        }
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location retrieved by QR code',
        'CheckInLocationService',
        {
          locationId: location.id,
          qrCode,
          responseTime: Date.now() - startTime,
        }
      );

      return location;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location by QR code: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          qrCode,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Update check-in location
   */
  async updateCheckInLocation(
    locationId: string,
    data: UpdateCheckInLocationDto,
    clinicId?: string
  ): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
      const existingLocation = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findUnique: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findUnique({
          where: { id: locationId },
        } as never);
      });

      // Check the owner BEFORE writing: the previous order updated the row and only then
      // compared clinics, so a foreign location was modified before the 403 was returned.
      if (!existingLocation || (clinicId && existingLocation.clinicId !== clinicId)) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }

      // Use executeHealthcareWrite for update with audit logging
      const location = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              checkInLocation: {
                update: <T>(args: T) => Promise<CheckInLocation>;
              };
            }
          ).checkInLocation.update({
            where: { id: locationId },
            data: {
              ...data,
              coordinates: data.coordinates as never,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: existingLocation.clinicId,
          resourceType: 'CHECK_IN_LOCATION',
          operation: 'UPDATE',
          resourceId: locationId,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`checkin-location:${locationId}`);
      if (location.clinicId) {
        await this.cacheService.invalidateCacheByTag(`clinic:${location.clinicId}`);
      }
      if (location.qrCode) {
        await this.cacheService.invalidateCache(`checkin-location:qr:${location.qrCode}`);
      }

      // Also invalidate shared location cache if locationId is linked
      if (location.locationId && this.locationCacheService) {
        await this.locationCacheService.invalidateLocation(location.locationId, location.clinicId);
      }

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location updated successfully',
        'CheckInLocationService',
        {
          locationId,
          responseTime: Date.now() - startTime,
        }
      );

      return location;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update check-in location: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Delete check-in location
   */
  async deleteCheckInLocation(locationId: string, clinicId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareRead first to get record for cache invalidation
      const location = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findFirst: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findFirst({
          where: {
            id: locationId,
            ...(clinicId ? { clinicId } : {}),
          },
        } as never);
      });

      if (!location) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }

      // Use executeHealthcareWrite for delete with audit logging
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              checkInLocation: {
                delete: <T>(args: T) => Promise<CheckInLocation>;
              };
            }
          ).checkInLocation.delete({
            where: { id: locationId },
          } as never);
        },
        {
          userId: 'system',
          clinicId: clinicId || location.clinicId || '',
          resourceType: 'CHECK_IN_LOCATION',
          operation: 'DELETE',
          resourceId: locationId,
          userRole: 'system',
          details: { locationName: location.locationName },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`checkin-location:id:${locationId}`);
      await this.cacheService.invalidateCache(
        `checkin-location:id:${clinicId || 'all'}:${locationId}`
      );
      if (clinicId || location.clinicId) {
        await this.cacheService.invalidateCacheByTag(`clinic:${clinicId || location.clinicId}`);
      }
      if (location.qrCode) {
        await this.cacheService.invalidateCache(`checkin-location:qr:${location.qrCode}`);
        await this.cacheService.invalidateCache(
          `checkin-location:qr:${clinicId || 'all'}:${location.qrCode}`
        );
      }

      // Also invalidate shared location cache if locationId is linked
      if (location.locationId && this.locationCacheService) {
        await this.locationCacheService.invalidateLocation(
          location.locationId,
          clinicId || location.clinicId
        );
      }

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Check-in location deleted successfully',
        'CheckInLocationService',
        {
          locationId,
          responseTime: Date.now() - startTime,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete check-in location: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  // =============================================
  // CHECK-IN PROCESSING
  // =============================================

  /**
   * Process check-in.
   *
   * Handles TWO distinct flows:
   *   1. Patient QR check-in — `locationId` is a `CheckInLocation` ID or linked `locationId`
   *      The `checkInLocation` record is found in the DB and used for coordinate validation.
   *   2. Receptionist manual check-in — `locationId` is a `ClinicLocation` ID.
   *      No `checkInLocation` record exists; we resolve via `ClinicLocationService` directly
   *      and skip coordinate validation.
   *
   * Order matters: every gate (video guard, ownership / receptionist location, status, timing,
   * presence, subscription coverage) runs BEFORE anything is written. The arrival is then claimed
   * with ONE conditional update (`checkedInAt IS NULL` and a SCHEDULED/CONFIRMED status) in the
   * same transaction that inserts the CheckIn row, so a lost race or a lapsed plan can never
   * leave an orphan CheckIn row, and a duplicate concurrent scan resolves to the same idempotent
   * result (`alreadyCheckedIn: true`) instead of a second row / a 500.
   *
   * Timing (every caller): the appointment must be on today's IST date, because the live queue is
   * keyed by today's IST date. A patient (or an unidentified caller) must also be inside the
   * 30 min before .. 3 h after window; staff may check in outside it on the same day.
   *
   * Queue repair: a CONFIRMED arrival that is already recorded is verified against the doctor's
   * live queue on every call and re-added when it is missing, so a queue push that failed after
   * the database commit (503) is repaired by simply retrying.
   */
  async processCheckIn(
    data: ProcessCheckInDto,
    clinicId?: string,
    options: ProcessCheckInOptions = {}
  ): Promise<ProcessedCheckIn> {
    const startTime = Date.now();
    const presence: CheckInPresenceMode = options.presence ?? 'if-supplied';

    try {
      const appointment = await this.loadAuthorizedAppointment(
        data.appointmentId,
        clinicId,
        options.actor
      );

      const currentStatus = String(appointment.status || '').toUpperCase();
      if (CHECK_IN_CLOSED_STATUSES.has(currentStatus)) {
        throw new BadRequestException('Appointment can no longer be checked in');
      }

      this.assertCheckInTiming(appointment, options.actor);

      const target = await this.resolveCheckInLocation(data, appointment, clinicId);
      this.assertPresence(presence, data.coordinates, target.location);

      const actorRole = options.actor?.role ? String(options.actor.role).toUpperCase() : undefined;
      const audit = {
        appointmentId: data.appointmentId,
        clinicId: appointment.clinicId,
        locationId: target.location.id,
        actorUserId: options.actor?.userId,
        actorRole,
        isManualReceptionCheckIn: target.isManualReceptionCheckIn,
      };

      // Arrival already recorded (sequential repeat or the loser of a concurrent scan).
      if (appointment.checkedInAt) {
        return await this.resolveAlreadyCheckedIn(appointment, data, target.location.id, audit);
      }

      // Coverage is checked before anything is inserted: a lapsed plan used to leave a CheckIn
      // row behind that then blocked every later attempt.
      await this.ensureActiveInPersonCoverage(appointment);

      const checkedInAt = new Date();
      const outcome = await this.databaseService.executeInTransaction<CheckInClaimOutcome>(
        async client => {
          const tx = client as unknown as CheckInTransactionClient;

          const claimed = await tx.appointment.updateMany({
            where: {
              id: data.appointmentId,
              clinicId: appointment.clinicId,
              checkedInAt: null,
              status: { in: [...CHECK_IN_ELIGIBLE_STATUSES] },
            },
            data: { checkedInAt, status: 'CONFIRMED' },
          });
          if (claimed.count === 0) {
            return { claimed: false };
          }

          // A stray row from an earlier failed attempt is reused rather than duplicated.
          const strayRow = await tx.checkIn.findFirst({
            where: { appointmentId: data.appointmentId, clinicId: appointment.clinicId },
            orderBy: { checkedInAt: 'asc' },
          });
          const rowData = {
            locationId: target.location.id,
            patientId: data.patientId,
            clinicId: appointment.clinicId,
            checkedInAt,
            coordinates: (data.coordinates ?? null) as never,
            deviceInfo: (data.deviceInfo ?? null) as never,
          };
          const row = strayRow
            ? await tx.checkIn.update({ where: { id: strayRow.id }, data: rowData })
            : await tx.checkIn.create({
                data: { appointmentId: data.appointmentId, ...rowData },
              });
          return { claimed: true, row };
        }
      );

      if (!outcome.claimed) {
        // Someone else checked this appointment in (or it closed) between our read and our write.
        const latest = await this.loadAppointmentForCheckIn(data.appointmentId, clinicId);
        const latestStatus = String(latest.status || '').toUpperCase();
        if (latest.checkedInAt && !CHECK_IN_CLOSED_STATUSES.has(latestStatus)) {
          return await this.resolveAlreadyCheckedIn(latest, data, target.location.id, audit);
        }
        throw new ConflictException(
          'This appointment is no longer eligible for check-in. Please refresh and try again.'
        );
      }

      // Map the raw Prisma row (field: checkedInAt) onto the domain CheckIn shape
      // (field: checkInTime) — the two intentionally diverge in naming, so callers
      // must not assume the Prisma result already matches @core/types/CheckIn.
      const checkIn: ProcessedCheckIn = this.mapCheckInRow(outcome.row);

      // The arrival is committed, so the cached appointment views are stale from here on whether
      // or not the queue push below succeeds: invalidate them in a `finally` so the 503 path
      // does not leave a stale SCHEDULED detail behind.
      try {
        // The live doctor queue is not part of the database transaction; a failure here is
        // retry-safe because the idempotent branch above re-queues a CONFIRMED arrival.
        await this.ensureQueued(appointment, data);
      } finally {
        await this.invalidateCheckInCaches(data.appointmentId, data.patientId);
      }

      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Appointment check-in recorded',
        'CheckInLocationService',
        { ...audit, checkInId: checkIn.id, status: 'CONFIRMED' }
      );
      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in processed successfully',
        'CheckInLocationService',
        {
          checkInId: checkIn.id,
          appointmentId: data.appointmentId,
          locationId: target.location.id,
          isManualReceptionCheckIn: target.isManualReceptionCheckIn,
          responseTime: Date.now() - startTime,
        }
      );

      return checkIn;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          appointmentId: data.appointmentId,
          locationId: data.locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Fresh read of the appointment. A missing appointment and one that belongs to another clinic
   * look identical (404), so existence is never revealed across clinics.
   */
  private async loadAppointmentForCheckIn(
    appointmentId: string,
    clinicId?: string
  ): Promise<CheckInAppointmentRow> {
    const appointment = await this.databaseService.executeHealthcareRead(async client => {
      const appointmentDelegate = client['appointment'] as unknown as {
        findUnique: (args: { where: { id: string } }) => Promise<CheckInAppointmentRow | null>;
      };
      return await appointmentDelegate.findUnique({ where: { id: appointmentId } });
    });

    if (!appointment || (clinicId && appointment.clinicId && appointment.clinicId !== clinicId)) {
      throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
    }
    return appointment;
  }

  /**
   * The appointment the caller may check in, in the one order every entry point must follow:
   * clinic-scoped fresh read (404), then the caller's access to THIS appointment (a patient must
   * own it, 403), and only then what kind of appointment it is. Access is decided before the type
   * so a patient who does not own an appointment gets the same 403 for a video visit as for an
   * in-person one and learns nothing about it.
   *
   * Video visits are paid and joined online. They never take part in clinic check-in or the
   * doctor queue, so they are rejected here, before any CheckIn row, status change or queue
   * entry exists. A receptionist's location rule needs a clinic location, so it comes after.
   */
  private async loadAuthorizedAppointment(
    appointmentId: string,
    clinicId: string | undefined,
    actor: ProcessCheckInOptions['actor']
  ): Promise<CheckInAppointmentRow> {
    const appointment = await this.loadAppointmentForCheckIn(appointmentId, clinicId);

    await this.assertPatientOwnsAppointment(appointment, actor);

    if (isVideoCallAppointmentType(appointment.type)) {
      throw new BadRequestException(VIDEO_CHECK_IN_REJECTION_MESSAGE);
    }

    await this.assertReceptionistAssignedToLocation(appointment, actor);
    return appointment;
  }

  /**
   * Entry-point helper (force check-in, reception check-in): the appointment, after the same
   * authorization `processCheckIn` applies (clinic scope, patient ownership, no video, receptionist
   * location). Controllers use it instead of a cached read so the 403 for a non-owner never
   * depends on what kind of appointment it is.
   */
  async getAppointmentForCheckIn(
    appointmentId: string,
    clinicId: string,
    actor?: ProcessCheckInOptions['actor']
  ): Promise<CheckInAppointmentSummary> {
    const appointment = await this.loadAuthorizedAppointment(appointmentId, clinicId, actor);
    return {
      id: appointment.id,
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      type: appointment.type,
      status: appointment.status,
      locationId: appointment.locationId ?? null,
      checkedInAt: appointment.checkedInAt ?? null,
    };
  }

  /** PATIENT: the appointment is theirs or an owned dependent's. Other roles pass. */
  private async assertPatientOwnsAppointment(
    appointment: CheckInAppointmentRow,
    actor: ProcessCheckInOptions['actor']
  ): Promise<void> {
    if (!actor || String(actor.role ?? '').toUpperCase() !== String(Role.PATIENT)) {
      return;
    }
    const owned = await isAppointmentOwnedByPatientUser(
      this.databaseService,
      appointment,
      actor.userId
    );
    if (!owned) {
      throw new ForbiddenException('Patients can only check in their own appointments');
    }
  }

  /**
   * RECEPTIONIST: fail closed. The receptionist's assigned location must be the appointment's
   * location; one without an assignment is accepted only in a clinic with exactly one active
   * location (see `isReceptionistAssignedToAppointmentLocation`). Other staff roles are
   * clinic-scoped by the caller and need no further check.
   */
  private async assertReceptionistAssignedToLocation(
    appointment: CheckInAppointmentRow,
    actor: ProcessCheckInOptions['actor']
  ): Promise<void> {
    if (!actor || String(actor.role ?? '').toUpperCase() !== String(Role.RECEPTIONIST)) {
      return;
    }
    const allowed = await isReceptionistAssignedToAppointmentLocation(
      this.databaseService,
      actor.userId,
      appointment.clinicId,
      appointment.locationId
    );
    if (!allowed) {
      throw new ForbiddenException('Receptionist is not assigned to this location');
    }
  }

  /**
   * When an arrival may be recorded. The live queue is keyed by today's IST date, so no caller
   * may check in an appointment that is not on today's IST date (a patient would otherwise end
   * up CONFIRMED in today's queue for next week's visit). A patient, or a caller that did not
   * identify itself (fail closed), must also be inside the 30 min before .. 3 h after window;
   * staff may check in outside it on the same day.
   */
  private assertCheckInTiming(
    appointment: CheckInAppointmentRow,
    actor: ProcessCheckInOptions['actor']
  ): void {
    const timing = assessCheckInTiming(appointment.date, appointment.time);
    if (!timing) {
      throw new BadRequestException(CHECK_IN_TIME_UNKNOWN_MESSAGE);
    }
    if (!timing.isSameIstDay) {
      throw createCheckInNotTodayException();
    }

    const role = String(actor?.role ?? '').toUpperCase();
    if (!STAFF_CHECK_IN_ROLES.has(role) && !timing.isWithinWindow) {
      throw createCheckInWindowClosedException();
    }
  }

  /**
   * Resolve the CheckInLocation the arrival is recorded against:
   * QR flow (CheckInLocation id / linked ClinicLocation id) or the reception desk flow
   * (ClinicLocation id that has a linked, active CheckInLocation).
   */
  private async resolveCheckInLocation(
    data: ProcessCheckInDto,
    appointment: CheckInAppointmentRow,
    clinicId?: string
  ): Promise<{ location: CheckInLocation; isManualReceptionCheckIn: boolean }> {
    const findLocation = (): Promise<CheckInLocation | null> =>
      this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findFirst: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findFirst({
          where: {
            OR: [{ id: data.locationId }, { locationId: data.locationId }],
            ...(clinicId ? { clinicId } : {}),
          },
        } as never);
      });

    const qrLocation = await findLocation();

    if (qrLocation) {
      if (!qrLocation.isActive) {
        throw new BadRequestException('Check-in location is not active');
      }
      if (qrLocation.clinicId !== appointment.clinicId) {
        throw new NotFoundException(`Location with ID ${data.locationId} not found`);
      }

      // If CheckInLocation links to a ClinicLocation, validate appointment location match
      if (qrLocation.locationId) {
        let clinicLocation: ClinicLocationResponseDto | null = null;

        if (this.locationCacheService) {
          clinicLocation = await this.locationCacheService.getLocation(
            qrLocation.locationId,
            false,
            clinicId
          );
          if (clinicLocation && clinicId && clinicLocation.clinicId !== clinicId) {
            clinicLocation = null;
          }
        }
        if (!clinicLocation && this.clinicLocationService) {
          clinicLocation = await this.clinicLocationService.getClinicLocationById(
            qrLocation.locationId,
            false,
            clinicId
          );
        }

        if (appointment.locationId && clinicLocation && qrLocation.locationId) {
          if (
            appointment.locationId !== clinicLocation.id &&
            appointment.locationId !== qrLocation.locationId
          ) {
            throw new BadRequestException(
              `Appointment is at location ${appointment.locationId}, but check-in is at location ${qrLocation.locationId}. Please visit the correct location.`
            );
          }
        }
      }

      return { location: qrLocation, isManualReceptionCheckIn: false };
    }

    // Reception desk flow: locationId is a ClinicLocation id.
    let clinicLocation: ClinicLocationResponseDto | null = null;

    if (this.locationCacheService) {
      clinicLocation = await this.locationCacheService.getLocation(
        data.locationId,
        false,
        clinicId
      );
      if (clinicLocation && clinicId && clinicLocation.clinicId !== clinicId) {
        clinicLocation = null;
      }
    }
    if (!clinicLocation && this.clinicLocationService) {
      clinicLocation = await this.clinicLocationService.getClinicLocationById(
        data.locationId,
        false,
        clinicId
      );
    }

    if (!clinicLocation) {
      throw new NotFoundException(`Location with ID ${data.locationId} not found`);
    }

    const linkedCheckInLocation = await findLocation();
    if (!linkedCheckInLocation) {
      throw new NotFoundException(
        `No check-in location is configured for clinic location ${data.locationId}`
      );
    }
    if (!linkedCheckInLocation.isActive) {
      throw new BadRequestException('Check-in location is not active');
    }
    if (linkedCheckInLocation.clinicId !== appointment.clinicId) {
      throw new NotFoundException(`Location with ID ${data.locationId} not found`);
    }

    return { location: linkedCheckInLocation, isManualReceptionCheckIn: true };
  }

  /**
   * Presence verification against the location geofence. See CheckInPresenceMode.
   * `required` (PATIENT force check-in) is fail-closed: missing / invalid / too-far coordinates
   * and a location without a usable geofence all produce the same single 403.
   */
  private assertPresence(
    mode: CheckInPresenceMode,
    coordinates: unknown,
    location: CheckInLocation
  ): void {
    if (mode === 'skip') {
      return;
    }

    // Seeded / legacy rows store { latitude, longitude }, the API writes { lat, lng }.
    const geofenceCenter = parseStoredGeofenceCenter(location.coordinates);

    if (mode === 'required') {
      const patientPosition = parseGeoCoordinates(coordinates);
      if (!patientPosition || !geofenceCenter) {
        throw createOutsideClinicRadiusException();
      }
      const distance = haversineDistanceMeters(patientPosition, geofenceCenter);
      const allowedMeters = resolveForceCheckInRadiusMeters(location.radius);
      // Fail closed: a NaN / non-finite distance is outside, `distance > allowedMeters` is not.
      if (!isWithinRadiusMeters(distance, allowedMeters)) {
        // The distance stays server-side; the client only ever sees the fixed message.
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Force check-in rejected: patient outside the allowed clinic radius',
          'CheckInLocationService',
          {
            locationId: location.id,
            distanceMeters: Number.isFinite(distance) ? Math.round(distance) : null,
            allowedMeters,
          }
        );
        throw createOutsideClinicRadiusException();
      }
      return;
    }

    // if-supplied: a QR scan is itself the presence proof, so coordinates stay optional,
    // but anything that is sent must be real numbers and inside the geofence.
    if (coordinates === undefined || coordinates === null) {
      return;
    }
    const patientPosition = parseGeoCoordinates(coordinates);
    if (!patientPosition) {
      throw new BadRequestException('Invalid check-in coordinates');
    }
    if (!geofenceCenter || !Number.isFinite(location.radius)) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Check-in location has no usable geofence; coordinates not validated',
        'CheckInLocationService',
        { locationId: location.id }
      );
      return;
    }
    const validation = this.validateLocation(patientPosition, geofenceCenter, location.radius);
    if (!validation.isValid) {
      throw new BadRequestException(validation.message);
    }
  }

  /**
   * Idempotent result for an appointment whose arrival is already recorded. A CONFIRMED arrival
   * (still waiting) is re-queued so a queue push that failed after the database commit repairs
   * itself on retry; once the consultation has started it is left alone.
   */
  private async resolveAlreadyCheckedIn(
    appointment: CheckInAppointmentRow,
    data: ProcessCheckInDto,
    checkInLocationId: string,
    audit: Record<string, unknown>
  ): Promise<ProcessedCheckIn> {
    const existing = await this.databaseService.executeHealthcareRead(async client => {
      return await (
        client as unknown as {
          checkIn: {
            findFirst: <T>(args: T) => Promise<CheckInRow | null>;
          };
        }
      ).checkIn.findFirst({
        where: { appointmentId: data.appointmentId, clinicId: appointment.clinicId },
        orderBy: { checkedInAt: 'asc' },
      } as never);
    });

    let queueRepaired = false;
    if (String(appointment.status || '').toUpperCase() === 'CONFIRMED') {
      // Anything but a clean "already queued" (a repair, or a failure that surfaces as 503) means
      // the cached appointment views may be stale.
      let queueChanged = true;
      try {
        queueRepaired = await this.ensureQueued(appointment, data);
        queueChanged = queueRepaired;
      } finally {
        if (queueChanged) {
          await this.invalidateCheckInCaches(data.appointmentId, data.patientId);
        }
      }
    }

    await this.loggingService.log(
      LogType.APPOINTMENT,
      LogLevel.INFO,
      'Check-in request resolved as already checked in',
      'CheckInLocationService',
      audit
    );

    if (existing) {
      return { ...this.mapCheckInRow(existing), alreadyCheckedIn: true, queueRepaired };
    }

    // Arrival recorded by another path (no CheckIn row): report the appointment's own timestamp.
    const arrivedAt = appointment.checkedInAt ?? new Date();
    return {
      id: '',
      appointmentId: data.appointmentId,
      locationId: checkInLocationId,
      checkInTime: arrivedAt,
      isVerified: false,
      verifiedBy: null,
      coordinates: null,
      deviceInfo: null,
      createdAt: arrivedAt,
      updatedAt: arrivedAt,
      alreadyCheckedIn: true,
      queueRepaired,
    };
  }

  private mapCheckInRow(row: CheckInRow): CheckIn {
    return {
      id: row.id,
      appointmentId: row.appointmentId,
      locationId: row.locationId,
      checkInTime: row.checkedInAt,
      isVerified: row.isVerified,
      verifiedBy: row.verifiedBy,
      coordinates: row.coordinates,
      deviceInfo: row.deviceInfo,
      createdAt: row.checkedInAt,
      updatedAt: row.checkedInAt,
    };
  }

  /**
   * Add the arrival to the doctor's live queue (in-person visits only; callers have already
   * rejected video) and report whether this call added it.
   *
   * The shared queue service throws a plain Error when the entry already exists; that is the
   * membership check, and it just means "already queued" (returns false). Everything else is
   * retry-safe, so it surfaces as 503 instead of an opaque 500. Not getting the per-appointment
   * lock (a stuck holder, or the cache being down) is also a 503: reporting success there would
   * leave a CONFIRMED arrival with no queue entry and no way to tell.
   */
  private async ensureQueued(
    appointment: CheckInAppointmentRow,
    data: ProcessCheckInDto
  ): Promise<boolean> {
    const lockKey = `lock:checkin-queue:${appointment.id}`;
    await this.acquireQueueLock(lockKey, data);

    try {
      const queueLocationId = appointment.locationId || data.locationId;
      await this.appointmentQueueService.checkIn(
        {
          appointmentId: data.appointmentId,
          doctorId: appointment.doctorId,
          patientId: data.patientId,
          clinicId: appointment.clinicId,
          appointmentType: appointment.type,
          // Queue entries are filtered by the appointment's ClinicLocation id (GET /queue?locationId=).
          ...(queueLocationId ? { locationId: queueLocationId } : {}),
        },
        'clinic'
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes(QUEUE_ENTRY_EXISTS_MARKER)) {
        return false;
      }
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Check-in recorded but the queue update failed: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        { appointmentId: data.appointmentId, clinicId: appointment.clinicId }
      );
      throw new ServiceUnavailableException(
        'Check-in was recorded but the queue could not be updated. Please try again.'
      );
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }

  /**
   * Take the per-appointment queue lock, waiting a short, bounded time for a concurrent request
   * that is queueing the very same arrival (a double click). Never proceeds without the lock:
   * after the last attempt (also when the cache client is down and every attempt fails) the
   * caller gets a retryable 503.
   */
  private async acquireQueueLock(lockKey: string, data: ProcessCheckInDto): Promise<void> {
    for (let attempt = 1; attempt <= QUEUE_LOCK_ATTEMPTS; attempt++) {
      if (await this.tryAcquireQueueLock(lockKey)) {
        return;
      }
      if (attempt < QUEUE_LOCK_ATTEMPTS) {
        await delay(QUEUE_LOCK_RETRY_DELAY_MS);
      }
    }

    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      'Check-in recorded but the queue lock could not be acquired',
      'CheckInLocationService',
      { appointmentId: data.appointmentId, lockKey }
    );
    throw new ServiceUnavailableException(
      'Check-in was recorded but the queue could not be updated. Please try again.'
    );
  }

  /** One attempt at the lock; a provider that throws (cache client down) counts as "not acquired". */
  private async tryAcquireQueueLock(lockKey: string): Promise<boolean> {
    try {
      return await this.cacheService.acquireLock(lockKey, QUEUE_LOCK_TTL_SECONDS);
    } catch {
      return false;
    }
  }

  /**
   * Drop the cached appointment views of a changed arrival. Runs in `finally` blocks, so a cache
   * outage is logged and must never replace the real outcome (or turn a success into a failure).
   */
  private async invalidateCheckInCaches(appointmentId: string, patientId: string): Promise<void> {
    try {
      await this.cacheService.invalidateCacheByTag(`appointment:${appointmentId}`);
      await this.cacheService.invalidateCacheByTag(`patient:${patientId}`);
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Cache invalidation after check-in failed: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        { appointmentId }
      );
    }
  }

  /**
   * Verify check-in
   */
  async verifyCheckIn(data: VerifyCheckInDto): Promise<CheckIn> {
    const startTime = Date.now();

    try {
      const existingCheckIn = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkIn: {
              findUnique: <T>(args: T) => Promise<CheckIn | null>;
            };
          }
        ).checkIn.findUnique({
          where: { id: data.checkInId },
          include: {
            location: true,
          },
        } as never);
      });
      const existingCheckInWithLocation = existingCheckIn as CheckIn & {
        location?: { clinicId?: string };
      };

      // Use executeHealthcareWrite for update with audit logging
      const checkIn = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              checkIn: {
                update: <T>(args: T) => Promise<CheckIn>;
              };
            }
          ).checkIn.update({
            where: { id: data.checkInId },
            data: {
              isVerified: true,
              verifiedBy: data.verifiedBy,
              notes: data.notes,
            },
            include: {
              location: true,
              patient: {
                include: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                      phone: true,
                    },
                  },
                },
              },
              appointment: true,
            },
          } as never);
        },
        {
          userId: data.verifiedBy,
          clinicId: existingCheckInWithLocation.location?.clinicId || '',
          resourceType: 'CHECK_IN',
          operation: 'UPDATE',
          resourceId: data.checkInId,
          userRole: 'system',
          details: { verified: true, verifiedBy: data.verifiedBy },
        }
      );

      // Invalidate cache using proper method
      const checkInWithAppointment = checkIn as CheckIn & { appointment?: { id: string } };
      if (checkInWithAppointment.appointment?.id) {
        await this.cacheService.invalidateCacheByTag(
          `appointment:${checkInWithAppointment.appointment.id}`
        );
      }

      // Also invalidate shared location cache if locationId is linked
      const checkInWithLocation = checkIn as CheckIn & {
        location?: { locationId?: string; clinicId?: string };
      };
      if (checkInWithLocation.location?.locationId && this.locationCacheService) {
        await this.locationCacheService.invalidateLocation(
          checkInWithLocation.location.locationId,
          checkInWithLocation.location.clinicId
        );
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in verified successfully',
        'CheckInLocationService',
        {
          checkInId: data.checkInId,
          verifiedBy: data.verifiedBy,
          responseTime: Date.now() - startTime,
        }
      );

      return checkIn;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify check-in: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get check-ins for a location
   */
  async getLocationCheckIns(
    locationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<CheckIn[]> {
    const startTime = Date.now();

    try {
      interface WhereClause {
        locationId: string;
        checkedInAt?: {
          gte: Date;
          lte: Date;
        };
      }

      const whereClause: WhereClause = { locationId };

      if (startDate && endDate) {
        whereClause.checkedInAt = {
          gte: startDate,
          lte: endDate,
        };
      }

      // Use executeHealthcareRead for optimized query
      const checkIns = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkIn: {
              findMany: <T>(args: T) => Promise<CheckIn[]>;
            };
          }
        ).checkIn.findMany({
          where: whereClause,
          include: {
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: {
              select: {
                id: true,
                type: true,
                date: true,
                time: true,
              },
            },
          },
          orderBy: { checkedInAt: 'desc' },
        } as never);
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location check-ins retrieved successfully',
        'CheckInLocationService',
        {
          locationId,
          count: checkIns.length,
          responseTime: Date.now() - startTime,
        }
      );

      return checkIns;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location check-ins: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get check-in statistics
   */
  async getCheckInStats(
    locationId: string,
    date?: Date
  ): Promise<{
    totalCheckIns: number;
    verified: number;
    unverified: number;
    averageCheckInTime: number;
  }> {
    const startTime = Date.now();

    try {
      interface StatsWhereClause {
        locationId: string;
        checkedInAt?: {
          gte: Date;
          lte: Date;
        };
      }

      const whereClause: StatsWhereClause = { locationId };

      if (date) {
        const startOfDay = startOfIstDay(date) ?? new Date(date);
        const endOfDay = endOfIstDay(date) ?? new Date(date);

        whereClause.checkedInAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }

      // Use executeHealthcareRead for optimized query
      const checkIns = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkIn: {
              findMany: <T>(args: T) => Promise<CheckIn[]>;
            };
          }
        ).checkIn.findMany({
          where: whereClause,
        } as never);
      });

      type CheckInWithVerification = { isVerified: boolean };
      const checkInsTyped = checkIns as CheckInWithVerification[];
      const stats = {
        totalCheckIns: checkIns.length,
        verified: checkInsTyped.filter((c: CheckInWithVerification) => c.isVerified).length,
        unverified: checkInsTyped.filter((c: CheckInWithVerification) => !c.isVerified).length,
        averageCheckInTime: 0, // Placeholder - would calculate based on actual data
      };

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Check-in stats retrieved successfully',
        'CheckInLocationService',
        {
          locationId,
          stats,
          responseTime: Date.now() - startTime,
        }
      );

      return stats;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in stats: ${error instanceof Error ? error.message : String(error)}`,
        'CheckInLocationService',
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  // =============================================
  // HELPER METHODS
  // =============================================

  /**
   * Compare a (already validated) patient position with a location geofence.
   */
  private validateLocation(
    patientCoords: GeoCoordinates,
    geofenceCenter: GeoCoordinates,
    radiusMeters: number
  ): CheckInValidation {
    const distance = haversineDistanceMeters(patientCoords, geofenceCenter);

    if (!isWithinRadiusMeters(distance, radiusMeters)) {
      return {
        isValid: false,
        distance,
        message: `Patient is ${Math.round(distance)}m away from the check-in location. Maximum allowed distance is ${radiusMeters}m.`,
      };
    }

    return {
      isValid: true,
      distance,
      message: 'Location validated successfully',
    };
  }

  /**
   * Generate unique QR code
   */
  private generateQRCode(clinicId: string, locationName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const nameHash = Buffer.from(locationName).toString('base64').substring(0, 8);
    return `CHK-${clinicId.substring(0, 8)}-${nameHash}-${timestamp}-${random}`;
  }
}
