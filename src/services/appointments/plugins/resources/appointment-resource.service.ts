import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { DatabaseService } from '@infrastructure/database';
import type { Resource, ResourceBooking, ResourceConflict } from '@core/types/appointment.types';

@Injectable()
export class AppointmentResourceService {
  private readonly logger = new Logger(AppointmentResourceService.name);
  private readonly RESOURCE_CACHE_TTL = 600; // 10 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Create resource
   */
  async createResource(
    resourceData: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Resource> {
    const resourceId = `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const resource: Resource = {
      id: resourceId,
      ...resourceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      // Cache the resource
      const cacheKey = `resource:${resourceId}`;
      await this.cacheService.set(cacheKey, resource, this.RESOURCE_CACHE_TTL);

      // Invalidate clinic resources cache
      await this.invalidateClinicResourcesCache(resourceData.clinicId);

      this.logger.log(`Created resource ${resourceId}`, {
        name: resourceData.name,
        type: resourceData.type,
        clinicId: resourceData.clinicId,
      });

      return resource;
    } catch (_error) {
      this.logger.error(`Failed to create resource`, {
        resourceName: resourceData.name,
        clinicId: resourceData.clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get resources for clinic
   */
  async getClinicResources(clinicId: string, type?: string): Promise<Resource[]> {
    const cacheKey = `clinic_resources:${clinicId}:${type || 'all'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as Resource[];
      }

      // Get resources from database using executeHealthcareRead
      const resources = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            resource: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).resource.findMany({
          where: {
            clinicId,
            isActive: true,
            ...(type && { type }),
          },
          orderBy: {
            name: 'asc',
          },
        } as never);
      });

      interface ResourceRow {
        id: string;
        name: string;
        type: 'room' | 'equipment' | 'vehicle' | 'other';
        clinicId: string;
        capacity: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      }

      const resourceList: Resource[] = resources.map((resource: unknown) => {
        const row = resource as ResourceRow;
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          clinicId: row.clinicId,
          capacity: row.capacity,
          features: [], // This could be stored in database as JSON
          isActive: row.isActive,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      // Type filtering is now handled in the query, so no need to filter here
      const filteredResources = resourceList;

      await this.cacheService.set(cacheKey, filteredResources, this.RESOURCE_CACHE_TTL);
      return filteredResources;
    } catch (_error) {
      this.logger.error(`Failed to get clinic resources`, {
        clinicId,
        type,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Book resource for appointment
   */
  async bookResource(
    resourceId: string,
    appointmentId: string,
    startTime: Date,
    endTime: Date,
    notes?: string
  ): Promise<ResourceBooking> {
    const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check for conflicts
    const conflicts = await this.checkResourceConflicts(resourceId, startTime, endTime);
    if (conflicts.length > 0) {
      throw new Error(
        `Resource conflicts detected: ${conflicts.map(c => c.conflictType).join(', ')}`
      );
    }

    const booking: ResourceBooking = {
      id: bookingId,
      resourceId,
      appointmentId,
      startTime,
      endTime,
      status: 'booked',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(notes && { notes }),
    };

    try {
      // Cache the booking
      const cacheKey = `resource_booking:${bookingId}`;
      await this.cacheService.set(cacheKey, booking, this.RESOURCE_CACHE_TTL);

      // Invalidate resource bookings cache
      await this.invalidateResourceBookingsCache(resourceId);

      this.logger.log(`Booked resource ${resourceId} for appointment ${appointmentId}`, {
        bookingId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      return booking;
    } catch (_error) {
      this.logger.error(`Failed to book resource`, {
        resourceId,
        appointmentId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Check for resource conflicts
   */
  async checkResourceConflicts(
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<ResourceConflict[]> {
    try {
      // Get existing bookings for the resource
      const existingBookings = await this.getResourceBookings(resourceId, startTime, endTime);

      const conflicts: ResourceConflict[] = [];

      // Check for time overlaps
      const overlappingBookings = existingBookings.filter(booking => {
        return (
          (startTime >= booking.startTime && startTime < booking.endTime) ||
          (endTime > booking.startTime && endTime <= booking.endTime) ||
          (startTime <= booking.startTime && endTime >= booking.endTime)
        );
      });

      if (overlappingBookings.length > 0) {
        conflicts.push({
          resourceId,
          conflictingBookings: overlappingBookings,
          suggestedAlternatives: await this.getAlternativeResources(resourceId),
          conflictType: 'time_overlap',
        });
      }

      return conflicts;
    } catch (_error) {
      this.logger.error(`Failed to check resource conflicts`, {
        resourceId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get resource bookings
   */
  async getResourceBookings(
    resourceId: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<ResourceBooking[]> {
    const cacheKey = `resource_bookings:${resourceId}:${startTime?.toISOString() || 'all'}:${endTime?.toISOString() || 'all'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as ResourceBooking[];
      }

      // Get bookings from database using executeHealthcareRead
      const bookings = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            resourceBooking: { findMany: <T>(args: T) => Promise<ResourceBooking[]> };
          }
        ).resourceBooking.findMany({
          where: {
            resourceId,
            ...(startTime && endTime
              ? {
                  startTime: { gte: startTime },
                  endTime: { lte: endTime },
                }
              : {}),
          },
          include: {
            appointment: {
              select: {
                id: true,
                patient: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            startTime: 'asc',
          },
        } as never);
      });

      interface BookingRow {
        id: string;
        resourceId: string;
        appointmentId: string;
        startTime: Date;
        endTime: Date;
        status: string;
        appointment?: {
          patient?: {
            user?: {
              name?: string;
            };
          };
        };
        createdAt: Date;
        updatedAt: Date;
      }

      const bookingList: ResourceBooking[] = bookings.map((booking: unknown) => {
        const row = booking as BookingRow;
        const statusValue = row.status;
        const validStatus: 'booked' | 'confirmed' | 'cancelled' =
          statusValue === 'booked' || statusValue === 'confirmed' || statusValue === 'cancelled'
            ? statusValue
            : 'booked';
        return {
          id: row.id,
          resourceId: row.resourceId,
          appointmentId: row.appointmentId,
          startTime: row.startTime,
          endTime: row.endTime,
          status: validStatus,
          notes: `Appointment with ${row.appointment?.patient?.user?.name || 'Unknown Patient'}`,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      // Filter by time range if provided
      const filteredBookings =
        startTime && endTime
          ? bookingList.filter(
              booking => booking.startTime >= startTime && booking.endTime <= endTime
            )
          : bookingList;

      await this.cacheService.set(cacheKey, filteredBookings, this.RESOURCE_CACHE_TTL);
      return filteredBookings;
    } catch (_error) {
      this.logger.error(`Failed to get resource bookings`, {
        resourceId,
        startTime: startTime?.toISOString(),
        endTime: endTime?.toISOString(),
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get alternative resources
   */
  async getAlternativeResources(resourceId: string): Promise<Resource[]> {
    try {
      // Get the original resource to find alternatives
      const originalResource = await this.getResource(resourceId);
      if (!originalResource) {
        return [];
      }

      // Get resources of the same type in the same clinic
      const alternatives = await this.getClinicResources(
        originalResource.clinicId,
        originalResource.type
      );

      // Filter out the original resource
      return alternatives.filter(resource => resource.id !== resourceId);
    } catch (_error) {
      this.logger.error(`Failed to get alternative resources`, {
        resourceId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return [];
    }
  }

  /**
   * Get resource by ID
   */
  async getResource(resourceId: string): Promise<Resource | null> {
    const cacheKey = `resource:${resourceId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as Resource;
      }

      // Get resource from database using executeHealthcareRead
      const resourceData = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            resource: {
              findUnique: <T>(args: T) => Promise<{
                id: string;
                name: string;
                type: string;
                clinicId: string;
                capacity: number;
                isActive: boolean;
                createdAt: Date;
                updatedAt: Date;
              } | null>;
            };
          }
        ).resource.findUnique({
          where: { id: resourceId },
        } as never);
      });

      if (!resourceData) {
        return null;
      }

      const resourceResult: Resource = {
        id: resourceData.id,
        name: resourceData.name,
        type: resourceData.type as 'room' | 'equipment' | 'vehicle' | 'other',
        clinicId: resourceData.clinicId,
        capacity: resourceData.capacity,
        features: [], // This could be stored in database as JSON
        isActive: resourceData.isActive,
        createdAt: resourceData.createdAt,
        updatedAt: resourceData.updatedAt,
      };

      await this.cacheService.set(cacheKey, resourceResult, this.RESOURCE_CACHE_TTL);
      return resourceResult;
    } catch (_error) {
      this.logger.error(`Failed to get resource`, {
        resourceId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return null;
    }
  }

  /**
   * Cancel resource booking
   */
  async cancelResourceBooking(bookingId: string): Promise<void> {
    try {
      // Update booking status
      const cacheKey = `resource_booking:${bookingId}`;
      const booking = (await this.cacheService.get(cacheKey)) as ResourceBooking;

      if (booking) {
        const updatedBooking = {
          ...booking,
          status: 'cancelled' as const,
          updatedAt: new Date(),
        };

        await this.cacheService.set(cacheKey, updatedBooking, this.RESOURCE_CACHE_TTL);

        // Invalidate resource bookings cache
        await this.invalidateResourceBookingsCache(booking.resourceId);

        this.logger.log(`Cancelled resource booking ${bookingId}`, {
          resourceId: booking.resourceId,
          appointmentId: booking.appointmentId,
        });
      }
    } catch (_error) {
      this.logger.error(`Failed to cancel resource booking`, {
        bookingId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Invalidate clinic resources cache
   */
  private async invalidateClinicResourcesCache(clinicId: string): Promise<void> {
    const cacheKeys = [
      `clinic_resources:${clinicId}:all`,
      `clinic_resources:${clinicId}:room`,
      `clinic_resources:${clinicId}:equipment`,
      `clinic_resources:${clinicId}:vehicle`,
    ];

    for (const cacheKey of cacheKeys) {
      await this.cacheService.delete(cacheKey);
    }
  }

  /**
   * Invalidate resource bookings cache
   */
  private async invalidateResourceBookingsCache(resourceId: string): Promise<void> {
    const cacheKey = `resource_bookings:${resourceId}:all:all`;
    await this.cacheService.delete(cacheKey);
  }
}
