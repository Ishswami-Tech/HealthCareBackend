import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LocationCacheService } from '@infrastructure/cache/services/location-cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  ClinicLocationCreateInput,
  ClinicLocationUpdateInput,
  ClinicLocationResponseDto,
  ClinicLocation,
} from '@core/types/clinic.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';

@Injectable()
export class ClinicLocationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LocationCacheService))
    private readonly locationCacheService?: LocationCacheService
  ) {}

  async createClinicLocation(
    data: ClinicLocationCreateInput,
    _userId: string
  ): Promise<ClinicLocationResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic location creation with full optimization layers
      const clinicLocation = await this.databaseService.executeHealthcareWrite<ClinicLocation>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicLocation.create({
            data: {
              ...data,
              workingHours: data.workingHours || '9:00 AM - 5:00 PM',
              isActive: data.isActive ?? true,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: _userId || 'system',
          clinicId: data.clinicId || '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: data.name, clinicId: data.clinicId },
        }
      );

      // Invalidate location cache after creation
      if (this.locationCacheService) {
        const locationWithClinicId = clinicLocation as ClinicLocation & { clinicId: string };
        await this.locationCacheService.invalidateLocation(
          locationWithClinicId.id,
          locationWithClinicId.clinicId
        );
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location created: ${clinicLocation.id}`,
        'ClinicLocationService',
        { locationId: clinicLocation.id }
      );

      return clinicLocation as ClinicLocationResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getLocations(
    clinicId: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto[]> {
    // Use LocationCacheService for shared cache
    if (this.locationCacheService) {
      const cached = await this.locationCacheService.getLocationsByClinic(clinicId, includeDoctors);
      if (cached) {
        return cached;
      }
    }

    // Fallback to direct cache or fetch
    const cacheKey = `clinic_locations:${clinicId}:${includeDoctors}`;

    if (this.cacheService) {
      const locations = await this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchLocations(clinicId, includeDoctors);
        },
        {
          ttl: 1800, // 30 minutes
          tags: ['clinic_locations', `clinic:${clinicId}`],
          enableSwr: true,
        }
      );

      // Also set in LocationCacheService for consistency
      if (this.locationCacheService) {
        await this.locationCacheService.setLocationsByClinic(clinicId, locations, includeDoctors);
      }

      return locations;
    }

    const locations = await this.fetchLocations(clinicId, includeDoctors);

    // Set in LocationCacheService if available
    if (this.locationCacheService) {
      await this.locationCacheService.setLocationsByClinic(clinicId, locations, includeDoctors);
    }

    return locations;
  }

  private async fetchLocations(
    clinicId: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const queryOptions: {
        where: { clinicId: string; isActive: boolean };
        include?: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: boolean;
                      name: boolean;
                      email: boolean;
                    };
                  };
                };
              };
            };
          };
        };
      } = {
        where: {
          clinicId,
          isActive: true,
        },
      };

      if (includeDoctors) {
        queryOptions.include = {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        };
      }

      const locations = await this.databaseService.executeHealthcareRead<
        ClinicLocationResponseDto[]
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.clinicLocation.findMany(
          queryOptions as PrismaDelegateArgs
        );
        return result as unknown as ClinicLocationResponseDto[];
      });

      return locations;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get locations: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicLocationById(
    id: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto | null> {
    try {
      // Use LocationCacheService for shared cache (single source of truth)
      if (this.locationCacheService) {
        const cached = await this.locationCacheService.getLocation(id, includeDoctors);
        if (cached) {
          return cached;
        }
      }

      // Cache miss - fetch from database
      const queryOptions: {
        where: { id: string };
        include?: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: boolean;
                      name: boolean;
                      email: boolean;
                    };
                  };
                };
              };
            };
          };
        };
      } = {
        where: { id },
      };

      if (includeDoctors) {
        queryOptions.include = {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        };
      }

      const location =
        await this.databaseService.executeHealthcareRead<ClinicLocationResponseDto | null>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            const result = await typedClient.clinicLocation.findFirst(
              queryOptions as PrismaDelegateArgs
            );
            return result as unknown as ClinicLocationResponseDto | null;
          }
        );

      // Cache the result in LocationCacheService
      if (location && this.locationCacheService) {
        await this.locationCacheService.setLocation(id, location, includeDoctors);
      }

      return location;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async updateLocation(
    id: string,
    data: ClinicLocationUpdateInput,
    _userId: string
  ): Promise<ClinicLocationResponseDto> {
    try {
      // Use executeHealthcareWrite for update with full optimization layers
      const location = await this.databaseService.executeHealthcareWrite<ClinicLocation>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicLocation.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              ...data,
              updatedAt: new Date(),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: _userId || 'system',
          clinicId:
            ('clinicId' in data && typeof data.clinicId === 'string' ? data.clinicId : '') || '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'UPDATE',
          resourceId: id,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      // Invalidate location cache after update
      if (this.locationCacheService) {
        const locationWithClinicId = location as ClinicLocation & { clinicId: string };
        await this.locationCacheService.invalidateLocation(
          locationWithClinicId.id,
          locationWithClinicId.clinicId
        );
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location updated: ${location.id}`,
        'ClinicLocationService',
        { locationId: location.id }
      );

      return location as ClinicLocationResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async deleteLocation(id: string, _userId: string): Promise<void> {
    try {
      // Use executeHealthcareWrite for soft delete with audit logging
      await this.databaseService.executeHealthcareWrite<ClinicLocation>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicLocation.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              isActive: false,
              updatedAt: new Date(),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: _userId || 'system',
          clinicId: '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'DELETE',
          resourceId: id,
          userRole: 'system',
          details: { locationId: id, softDelete: true },
        }
      );

      // Invalidate location cache after deletion
      if (this.locationCacheService) {
        // Get clinicId before invalidating (if needed)
        const location = await this.getClinicLocationById(id, false);
        if (location) {
          await this.locationCacheService.invalidateLocation(id, location.clinicId);
        } else {
          await this.locationCacheService.invalidateLocation(id);
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location deactivated: ${id}`,
        'ClinicLocationService',
        { locationId: id }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getLocationCount(clinicId: string): Promise<number> {
    try {
      // Use executeHealthcareRead for count query
      const count = await this.databaseService.executeHealthcareRead<number>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinicLocation.count({
          where: {
            clinicId,
            isActive: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      });

      return count;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location count: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicOperatingHours(
    clinicId: string
  ): Promise<Array<{ locationName: string; locationId: string; workingHours: string }>> {
    try {
      const locations = await this.getLocations(clinicId);
      return locations.map(loc => ({
        locationName: loc.name,
        locationId: loc.id,
        workingHours: loc.workingHours,
      }));
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic operating hours: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      return [];
    }
  }
}
