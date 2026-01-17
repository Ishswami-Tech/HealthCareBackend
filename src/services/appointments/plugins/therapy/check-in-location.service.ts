import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LocationCacheService } from '@infrastructure/cache/services/location-cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import type { ClinicLocationResponseDto } from '@core/types/clinic.types';
import type {
  CheckInLocation,
  CheckIn,
  CreateCheckInLocationDto,
  UpdateCheckInLocationDto,
  ProcessCheckInDto,
  VerifyCheckInDto,
  CheckInValidation,
} from '@core/types/appointment.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';

@Injectable()
export class CheckInLocationService {
  private readonly LOCATION_CACHE_TTL = 3600; // 1 hour
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => LocationCacheService))
    private readonly locationCacheService?: LocationCacheService,
    @Optional()
    @Inject(forwardRef(() => ClinicLocationService))
    private readonly clinicLocationService?: ClinicLocationService
  ) {}

  /**
   * Create a new check-in location
   */
  async createCheckInLocation(data: CreateCheckInLocationDto): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
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
      throw error;
    }
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
          return JSON.parse(cached as string) as CheckInLocation[];
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
          await this.locationCacheService.warmLocations(locationIds, async (locationId: string) => {
            return await this.clinicLocationService!.getClinicLocationById(locationId, false);
          });
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
  async getLocationById(locationId: string): Promise<CheckInLocation> {
    const startTime = Date.now();
    const cacheKey = `checkin-location:id:${locationId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached && cached !== '') {
        try {
          return JSON.parse(cached as string) as CheckInLocation;
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
              findUnique: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findUnique({
          where: { id: locationId },
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
          false
        );
        if (!clinicLocation) {
          // Cache miss - fetch and populate shared cache
          const fetched = await this.clinicLocationService.getClinicLocationById(
            location.locationId,
            false
          );
          if (fetched) {
            await this.locationCacheService.setLocation(location.locationId, fetched, false);
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
  async getLocationByQRCode(qrCode: string): Promise<CheckInLocation> {
    const startTime = Date.now();
    const cacheKey = `checkin-location:qr:${qrCode}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached && cached !== '') {
        try {
          return JSON.parse(cached as string) as CheckInLocation;
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
              findUnique: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findUnique({
          where: { qrCode },
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
          false
        );
        if (!clinicLocation) {
          // Cache miss - fetch and populate shared cache
          const fetched = await this.clinicLocationService.getClinicLocationById(
            location.locationId,
            false
          );
          if (fetched) {
            await this.locationCacheService.setLocation(location.locationId, fetched, false);
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
    data: UpdateCheckInLocationDto
  ): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
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
          clinicId: '',
          resourceType: 'CHECK_IN_LOCATION',
          operation: 'UPDATE',
          resourceId: locationId,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`checkin-location:${locationId}`);
      await this.cacheService.invalidateCacheByTag(`clinic:${location.clinicId}`);
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
  async deleteCheckInLocation(locationId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareRead first to get record for cache invalidation
      const location = await this.databaseService.executeHealthcareRead(async client => {
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
          clinicId: location.clinicId || '',
          resourceType: 'CHECK_IN_LOCATION',
          operation: 'DELETE',
          resourceId: locationId,
          userRole: 'system',
          details: { locationName: location.locationName },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`checkin-location:${locationId}`);
      await this.cacheService.invalidateCacheByTag(`clinic:${location.clinicId}`);
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
   * Process check-in
   */
  async processCheckIn(data: ProcessCheckInDto): Promise<CheckIn> {
    const startTime = Date.now();

    try {
      // Validate appointment exists using executeHealthcareRead
      const appointmentData = await this.databaseService.executeHealthcareRead(async client => {
        const appointmentDelegate = client['appointment'] as {
          findUnique: (args: { where: { id: string } }) => Promise<unknown>;
        };
        return await appointmentDelegate.findUnique({
          where: { id: data.appointmentId },
        });
      });

      if (!appointmentData) {
        throw new NotFoundException(`Appointment with ID ${data.appointmentId} not found`);
      }

      // Check if already checked in using executeHealthcareRead
      const existingCheckIn = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkIn: {
              findFirst: <T>(args: T) => Promise<CheckIn | null>;
            };
          }
        ).checkIn.findFirst({
          where: {
            appointmentId: data.appointmentId,
          },
        } as never);
      });

      if (existingCheckIn) {
        throw new BadRequestException('Appointment already checked in');
      }

      // Get location details using executeHealthcareRead
      const location = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            checkInLocation: {
              findUnique: <T>(args: T) => Promise<CheckInLocation | null>;
            };
          }
        ).checkInLocation.findUnique({
          where: { id: data.locationId },
        } as never);
      });

      if (!location) {
        throw new NotFoundException(`Location with ID ${data.locationId} not found`);
      }

      if (!location.isActive) {
        throw new BadRequestException('Check-in location is not active');
      }

      // If CheckInLocation has locationId linking to ClinicLocation, validate using LocationCacheService
      if (location.locationId) {
        let clinicLocation: ClinicLocationResponseDto | null = null;

        // Try LocationCacheService first (shared cache)
        if (this.locationCacheService) {
          clinicLocation = await this.locationCacheService.getLocation(location.locationId, false);
        }

        // Cache miss - fetch from ClinicLocationService
        if (!clinicLocation && this.clinicLocationService) {
          clinicLocation = await this.clinicLocationService.getClinicLocationById(
            location.locationId,
            false
          );
        }

        // Validate appointment location matches check-in location
        const appointmentWithLocation = appointmentData as { locationId?: string };
        if (appointmentWithLocation.locationId && clinicLocation && location.locationId) {
          if (
            appointmentWithLocation.locationId !== clinicLocation.id &&
            appointmentWithLocation.locationId !== location.locationId
          ) {
            throw new BadRequestException(
              `Appointment is at location ${appointmentWithLocation.locationId}, but check-in is at location ${location.locationId}. Please visit the correct location.`
            );
          }
        }
      }

      // Validate location if coordinates provided
      if (data.coordinates) {
        const validation = this.validateLocation(data.coordinates, location);
        if (!validation.isValid) {
          throw new BadRequestException(validation.message);
        }
      }

      // Create check-in using executeHealthcareWrite with audit logging
      const checkIn = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              checkIn: {
                create: <T>(args: T) => Promise<CheckIn>;
              };
            }
          ).checkIn.create({
            data: {
              appointmentId: data.appointmentId,
              locationId: data.locationId,
              patientId: data.patientId,
              clinicId: location.clinicId, // Denormalized for 10M+ scale analytics
              coordinates: data.coordinates as never,
              deviceInfo: data.deviceInfo as never,
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
              appointment: {
                select: {
                  id: true,
                  type: true,
                  date: true,
                  time: true,
                },
              },
            },
          } as never);
        },
        {
          userId: data.patientId,
          clinicId: location?.clinicId || '',
          resourceType: 'CHECK_IN',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'patient',
          details: { appointmentId: data.appointmentId, locationId: data.locationId },
        }
      );

      // Get appointment to retrieve doctorId and calculate queue number
      const appointmentRecord = await this.databaseService.findAppointmentByIdSafe(
        data.appointmentId
      );
      if (!appointmentRecord) {
        throw new NotFoundException(`Appointment ${data.appointmentId} not found`);
      }

      // Check if queue already exists (before creating/updating)
      let existingQueue: { id: string } | null = null;
      try {
        existingQueue = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              queue: {
                findUnique: <T>(args: T) => Promise<{ id: string } | null>;
              };
            };
            return await typedClient.queue.findUnique({
              where: { appointmentId: data.appointmentId } as PrismaDelegateArgs,
              select: { id: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        );
      } catch {
        // Queue doesn't exist yet, will create new one
        existingQueue = null;
      }

      // Update appointment status using executeHealthcareWrite
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const appointmentDelegate = client['appointment'] as {
            update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
          };
          return await appointmentDelegate.update({
            where: { id: data.appointmentId },
            data: {
              checkedInAt: new Date(),
              status: 'CHECKED_IN',
            },
          });
        },
        {
          userId: data.patientId,
          clinicId: location?.clinicId || '',
          resourceType: 'APPOINTMENT',
          operation: 'UPDATE',
          resourceId: data.appointmentId,
          userRole: 'patient',
          details: { status: 'CHECKED_IN' },
        }
      );

      // Create or update Queue record with locationId
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            queue: {
              findMany: <T>(args: T) => Promise<Array<{ queueNumber?: number }>>;
              update: <T>(args: T) => Promise<unknown>;
              create: <T>(args: T) => Promise<unknown>;
            };
          };

          // Count existing queues for this location to calculate queue number
          const locationQueues = await typedClient.queue.findMany({
            where: {
              locationId: data.locationId,
              status: { in: ['WAITING', 'IN_PROGRESS'] },
            } as PrismaDelegateArgs,
            orderBy: { queueNumber: 'desc' } as PrismaDelegateArgs,
            take: 1,
          } as PrismaDelegateArgs);

          const queueNumber =
            locationQueues.length > 0
              ? ((locationQueues[0] as { queueNumber?: number })?.queueNumber ?? 0) + 1
              : 1;

          if (existingQueue) {
            // Update existing queue
            return await typedClient.queue.update({
              where: { appointmentId: data.appointmentId } as PrismaDelegateArgs,
              data: {
                locationId: data.locationId,
                status: 'WAITING',
                queueNumber: queueNumber,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          } else {
            // Create new queue record
            return await typedClient.queue.create({
              data: {
                appointmentId: data.appointmentId,
                clinicId: location.clinicId,
                locationId: data.locationId,
                queueNumber: queueNumber,
                status: 'WAITING',
                estimatedWaitTime: queueNumber * 10, // 10 minutes per position
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        },
        {
          userId: data.patientId,
          clinicId: location?.clinicId || '',
          resourceType: 'QUEUE',
          operation: existingQueue ? 'UPDATE' : 'CREATE',
          resourceId: data.appointmentId,
          userRole: 'patient',
          details: { appointmentId: data.appointmentId, locationId: data.locationId },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCacheByTag(`appointment:${data.appointmentId}`);
      await this.cacheService.invalidateCacheByTag(`patient:${data.patientId}`);

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Check-in processed successfully',
        'CheckInLocationService',
        {
          checkInId: checkIn.id,
          appointmentId: data.appointmentId,
          locationId: data.locationId,
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
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Verify check-in
   */
  async verifyCheckIn(data: VerifyCheckInDto): Promise<CheckIn> {
    const startTime = Date.now();

    try {
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
          clinicId: '',
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
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

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
   * Validate location coordinates
   */
  private validateLocation(
    patientCoords: { lat: number; lng: number },
    location: CheckInLocation
  ): CheckInValidation {
    const locationCoords = location.coordinates;
    const lat = locationCoords['lat'];
    const lng = locationCoords['lng'];
    if (lat === undefined || lng === undefined) {
      throw new Error('Location coordinates are missing lat or lng');
    }
    const distance = this.calculateDistance(patientCoords.lat, patientCoords.lng, lat, lng);

    if (distance > location.radius) {
      return {
        isValid: false,
        distance,
        message: `Patient is ${Math.round(distance)}m away from the check-in location. Maximum allowed distance is ${location.radius}m.`,
      };
    }

    return {
      isValid: true,
      distance,
      message: 'Location validated successfully',
    };
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
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
