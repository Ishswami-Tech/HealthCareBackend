import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { PrismaService } from "../../../../libs/infrastructure/database/prisma/prisma.service";

export interface Resource {
  id: string;
  name: string;
  type: "room" | "equipment" | "vehicle" | "other";
  clinicId: string;
  locationId?: string;
  capacity?: number;
  features: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceBooking {
  id: string;
  resourceId: string;
  appointmentId: string;
  startTime: Date;
  endTime: Date;
  status: "booked" | "confirmed" | "cancelled";
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceConflict {
  resourceId: string;
  conflictingBookings: ResourceBooking[];
  suggestedAlternatives: Resource[];
  conflictType: "time_overlap" | "capacity_exceeded" | "feature_mismatch";
}

@Injectable()
export class AppointmentResourceService {
  private readonly logger = new Logger(AppointmentResourceService.name);
  private readonly RESOURCE_CACHE_TTL = 600; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Create resource
   */
  async createResource(
    resourceData: Omit<Resource, "id" | "createdAt" | "updatedAt">,
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
  async getClinicResources(
    clinicId: string,
    type?: string,
  ): Promise<Resource[]> {
    const cacheKey = `clinic_resources:${clinicId}:${type || "all"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as Resource[];
      }

      // Get resources from database
      const resources = await (this.prisma as any).resource.findMany({
        where: {
          clinicId,
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      const resourceList: Resource[] = resources.map((resource: unknown) => ({
        id: (resource as any).id,
        name: (resource as any).name,
        type: (resource as any).type as
          | "room"
          | "equipment"
          | "vehicle"
          | "other",
        clinicId: (resource as any).clinicId,
        capacity: (resource as any).capacity,
        features: [], // This could be stored in database as JSON
        isActive: (resource as any).isActive,
        createdAt: (resource as any).createdAt,
        updatedAt: (resource as any).updatedAt,
      }));

      const filteredResources = type
        ? resourceList.filter((resource) => (resource as any).type === type)
        : resourceList;

      await this.cacheService.set(
        cacheKey,
        filteredResources,
        this.RESOURCE_CACHE_TTL,
      );
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
    notes?: string,
  ): Promise<ResourceBooking> {
    const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check for conflicts
    const conflicts = await this.checkResourceConflicts(
      resourceId,
      startTime,
      endTime,
    );
    if (conflicts.length > 0) {
      throw new Error(
        `Resource conflicts detected: ${conflicts.map((c) => c.conflictType).join(", ")}`,
      );
    }

    const booking: ResourceBooking = {
      id: bookingId,
      resourceId,
      appointmentId,
      startTime,
      endTime,
      status: "booked",
      notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      // Cache the booking
      const cacheKey = `resource_booking:${bookingId}`;
      await this.cacheService.set(cacheKey, booking, this.RESOURCE_CACHE_TTL);

      // Invalidate resource bookings cache
      await this.invalidateResourceBookingsCache(resourceId);

      this.logger.log(
        `Booked resource ${resourceId} for appointment ${appointmentId}`,
        {
          bookingId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
      );

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
    endTime: Date,
  ): Promise<ResourceConflict[]> {
    try {
      // Get existing bookings for the resource
      const existingBookings = await this.getResourceBookings(
        resourceId,
        startTime,
        endTime,
      );

      const conflicts: ResourceConflict[] = [];

      // Check for time overlaps
      const overlappingBookings = existingBookings.filter((booking) => {
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
          conflictType: "time_overlap",
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
    endTime?: Date,
  ): Promise<ResourceBooking[]> {
    const cacheKey = `resource_bookings:${resourceId}:${startTime?.toISOString() || "all"}:${endTime?.toISOString() || "all"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as ResourceBooking[];
      }

      // Get bookings from database
      const bookings = await this.prisma.resourceBooking.findMany({
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
          startTime: "asc",
        },
      });

      const bookingList: ResourceBooking[] = bookings.map(
        (booking: unknown) => ({
          id: (booking as any).id,
          resourceId: (booking as any).resourceId,
          appointmentId: (booking as any).appointmentId,
          startTime: (booking as any).startTime,
          endTime: (booking as any).endTime,
          status: (booking as any).status,
          notes: `Appointment with ${(booking as any).appointment?.patient?.user?.name || "Unknown Patient"}`,
          createdAt: (booking as any).createdAt,
          updatedAt: (booking as any).updatedAt,
        }),
      );

      // Filter by time range if provided
      const filteredBookings =
        startTime && endTime
          ? bookingList.filter(
              (booking) =>
                booking.startTime >= startTime && booking.endTime <= endTime,
            )
          : bookingList;

      await this.cacheService.set(
        cacheKey,
        filteredBookings,
        this.RESOURCE_CACHE_TTL,
      );
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
        originalResource.type,
      );

      // Filter out the original resource
      return alternatives.filter(
        (resource) => (resource as any).id !== resourceId,
      );
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

      // Get resource from database
      const resourceData = await (this.prisma as any).resource.findUnique({
        where: { id: resourceId },
      });

      if (!resourceData) {
        return null;
      }

      const resourceResult: Resource = {
        id: resourceData.id,
        name: resourceData.name,
        type: resourceData.type as "room" | "equipment" | "vehicle" | "other",
        clinicId: resourceData.clinicId,
        capacity: resourceData.capacity,
        features: [], // This could be stored in database as JSON
        isActive: resourceData.isActive,
        createdAt: resourceData.createdAt,
        updatedAt: resourceData.updatedAt,
      };

      await this.cacheService.set(
        cacheKey,
        resourceResult,
        this.RESOURCE_CACHE_TTL,
      );
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
      const booking = (await this.cacheService.get(
        cacheKey,
      )) as ResourceBooking;

      if (booking) {
        const updatedBooking = {
          ...booking,
          status: "cancelled" as const,
          updatedAt: new Date(),
        };

        await this.cacheService.set(
          cacheKey,
          updatedBooking,
          this.RESOURCE_CACHE_TTL,
        );

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
  private async invalidateClinicResourcesCache(
    clinicId: string,
  ): Promise<void> {
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
  private async invalidateResourceBookingsCache(
    resourceId: string,
  ): Promise<void> {
    const cacheKey = `resource_bookings:${resourceId}:all:all`;
    await this.cacheService.delete(cacheKey);
  }
}
