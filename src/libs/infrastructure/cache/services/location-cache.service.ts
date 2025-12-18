import { Injectable, Inject } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggerLike } from '@core/types';
import { LogType, LogLevel } from '@core/types';
import type { ClinicLocationResponseDto, ClinicLocation } from '@core/types/clinic.types';

/**
 * Location Cache Service
 *
 * Shared cache layer for location data - single source of truth
 * Used by ALL services (ClinicLocationService, LocationManagementService,
 * AppointmentLocationService, CheckInLocationService) to ensure consistency
 *
 * Optimized for 10M+ users with:
 * - Shared cache keys across all services
 * - Automatic cache invalidation
 * - Cache warming support
 * - High cache hit rates (95%+)
 *
 * @see docs/architecture/LOCATION_SERVICES_SCALE_10M.md
 */
@Injectable()
export class LocationCacheService {
  private readonly CACHE_PREFIX = 'location';
  private readonly DEFAULT_TTL = 3600; // 1 hour
  private readonly LOCATIONS_LIST_TTL = 1800; // 30 minutes

  constructor(
    private readonly cacheService: CacheService,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike
  ) {}

  /**
   * Get location with shared cache (single source of truth)
   * Used by ALL services to ensure consistency
   *
   * @param locationId - Location ID
   * @param includeDoctors - Whether to include doctors (affects cache key)
   * @returns Location data or null if not in cache
   */
  async getLocation(
    locationId: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto | null> {
    const cacheKey = this.getLocationKey(locationId, includeDoctors);
    const startTime = Date.now();

    try {
      // Direct cache get (no fetchFn to avoid circular dependency)
      const cached = await this.cacheService.get<ClinicLocationResponseDto>(cacheKey);

      if (cached) {
        const responseTime = Date.now() - startTime;
        if (responseTime > 100) {
          // Log slow cache operations
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.WARN,
            'Slow location cache retrieval',
            'LocationCacheService',
            { locationId, responseTime }
          );
        }
        return cached;
      }

      // Cache miss - return null, caller should fetch from database
      return null;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location from cache: ${(error as Error).message}`,
        'LocationCacheService',
        { locationId, error: (error as Error).stack }
      );
      // Return null on error - caller will fetch from database
      return null;
    }
  }

  /**
   * Set location in shared cache
   * Called after fetching from database to populate cache
   *
   * @param locationId - Location ID
   * @param location - Location data
   * @param includeDoctors - Whether doctors are included
   */
  async setLocation(
    locationId: string,
    location: ClinicLocationResponseDto | ClinicLocation,
    includeDoctors = false
  ): Promise<void> {
    const cacheKey = this.getLocationKey(locationId, includeDoctors);

    try {
      // Use cache() method with forceRefresh to ensure value is set
      // Tags are handled via cache() method's options
      await this.cacheService.cache(cacheKey, () => Promise.resolve(location), {
        ttl: this.DEFAULT_TTL,
        tags: ['locations', `location:${locationId}`],
        enableSwr: true,
        forceRefresh: true, // Force set the value
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to set location in cache: ${(error as Error).message}`,
        'LocationCacheService',
        { locationId, error: (error as Error).stack }
      );
      // Don't throw - cache failures shouldn't break the flow
    }
  }

  /**
   * Get locations list for a clinic
   *
   * @param clinicId - Clinic ID
   * @param includeDoctors - Whether to include doctors
   * @returns Locations array or null if not in cache
   */
  async getLocationsByClinic(
    clinicId: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto[] | null> {
    const cacheKey = this.getLocationsListKey(clinicId, includeDoctors);

    try {
      // Direct cache get (no fetchFn to avoid circular dependency)
      const cached = await this.cacheService.get<ClinicLocationResponseDto[]>(cacheKey);
      return cached || null;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to get locations list from cache: ${(error as Error).message}`,
        'LocationCacheService',
        { clinicId, error: (error as Error).stack }
      );
      return null;
    }
  }

  /**
   * Set locations list for a clinic
   *
   * @param clinicId - Clinic ID
   * @param locations - Locations array
   * @param includeDoctors - Whether doctors are included
   */
  async setLocationsByClinic(
    clinicId: string,
    locations: ClinicLocationResponseDto[],
    includeDoctors = false
  ): Promise<void> {
    const cacheKey = this.getLocationsListKey(clinicId, includeDoctors);

    try {
      // Use cache() method with forceRefresh to ensure value is set
      await this.cacheService.cache(cacheKey, () => Promise.resolve(locations), {
        ttl: this.LOCATIONS_LIST_TTL,
        tags: ['locations', `clinic:${clinicId}`, 'location_lists'],
        enableSwr: true,
        forceRefresh: true, // Force set the value
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to set locations list in cache: ${(error as Error).message}`,
        'LocationCacheService',
        { clinicId, error: (error as Error).stack }
      );
    }
  }

  /**
   * Invalidate location cache (called on updates/deletes)
   * Also invalidates related caches (appointment, check-in, user locations)
   *
   * @param locationId - Location ID
   * @param clinicId - Optional clinic ID for list invalidation
   */
  async invalidateLocation(locationId: string, clinicId?: string): Promise<void> {
    try {
      // Invalidate all variants of this location
      const keysToInvalidate = [
        this.getLocationKey(locationId, false),
        this.getLocationKey(locationId, true),
      ];

      // Also invalidate related domain-specific caches
      keysToInvalidate.push(
        `appt:location:${locationId}`,
        `checkin:location:${locationId}`,
        `user:location:${locationId}`
      );

      // Invalidate location lists if clinicId provided
      if (clinicId) {
        keysToInvalidate.push(
          this.getLocationsListKey(clinicId, false),
          this.getLocationsListKey(clinicId, true)
        );
      }

      // Use tag-based invalidation for better performance
      await this.cacheService.invalidateCacheByTag(`location:${locationId}`);

      // Also invalidate clinic locations list tag if clinicId provided
      if (clinicId) {
        await this.cacheService.invalidateCacheByTag(`clinic:${clinicId}`);
      }

      // Also invalidate by keys for immediate effect
      await Promise.allSettled(keysToInvalidate.map(key => this.cacheService.del(key)));

      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Location cache invalidated',
        'LocationCacheService',
        { locationId, clinicId, keysInvalidated: keysToInvalidate.length }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to invalidate location cache: ${(error as Error).message}`,
        'LocationCacheService',
        { locationId, error: (error as Error).stack }
      );
    }
  }

  /**
   * Warm location cache (pre-load frequently accessed locations)
   * Used by CacheWarmingService for proactive caching
   *
   * @param locationIds - Array of location IDs to warm
   */
  async warmLocations(
    locationIds: string[],
    fetchFn: (locationId: string) => Promise<ClinicLocationResponseDto | null>
  ): Promise<{ warmed: number; failed: number }> {
    let warmed = 0;
    let failed = 0;

    try {
      const results = await Promise.allSettled(
        locationIds.map(async locationId => {
          // Check if already cached
          const cached = await this.getLocation(locationId, false);
          if (cached) {
            warmed++;
            return;
          }

          // Fetch and cache
          try {
            const location = await fetchFn(locationId);
            if (location) {
              await this.setLocation(locationId, location, false);
              warmed++;
            } else {
              failed++;
            }
          } catch (error) {
            failed++;
            throw error;
          }
        })
      );

      // Count failures
      results.forEach(result => {
        if (result.status === 'rejected') {
          failed++;
        }
      });

      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Location cache warming completed',
        'LocationCacheService',
        { total: locationIds.length, warmed, failed }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Location cache warming failed: ${(error as Error).message}`,
        'LocationCacheService',
        { error: (error as Error).stack }
      );
    }

    return { warmed, failed };
  }

  /**
   * Get cache key for a single location
   */
  private getLocationKey(locationId: string, includeDoctors: boolean): string {
    return `${this.CACHE_PREFIX}:${locationId}:${includeDoctors ? 'with-doctors' : 'basic'}`;
  }

  /**
   * Get cache key for locations list
   */
  private getLocationsListKey(clinicId: string, includeDoctors: boolean): string {
    return `${this.CACHE_PREFIX}:list:${clinicId}:${includeDoctors ? 'with-doctors' : 'basic'}`;
  }
}
