import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
import { HealthcareDatabaseClient } from './clients/healthcare-database.client';
import type { PrismaService } from './prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { ClinicContext } from '@core/types/clinic.types';
import type { ClinicIsolationResult } from '@core/types/database.types';

// Re-export for backward compatibility
export type { ClinicContext } from '@core/types/clinic.types';
export type { ClinicIsolationResult } from '@core/types/database.types';

/**
 * Clinic Isolation Service for Healthcare Multi-Clinic Architecture
 * Handles data isolation and routing between multiple clinics within single healthcare app
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use HealthcareDatabaseClient instead.
 * @internal
 */
@Injectable()
export class ClinicIsolationService implements OnModuleInit {
  private readonly serviceName = 'ClinicIsolationService';
  private clinicCache = new Map<string, ClinicContext>();
  private userClinicCache = new Map<string, string[]>(); // userId -> clinicIds[]
  private locationClinicCache = new Map<string, string>(); // locationId -> clinicId
  private cacheUpdateInterval!: NodeJS.Timeout;
  private maxClinics: number;
  private maxLocationsPerClinic: number;
  private cacheHitCount = 0;
  private cacheMissCount = 0;
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 10000; // Maximum cache entries

  constructor(
    @Inject(forwardRef(() => HealthcareDatabaseClient))
    private databaseService: HealthcareDatabaseClient,
    private configService: ConfigService,
    private loggingService: LoggingService
  ) {
    // Use ConfigService with dotted notation for configuration access
    // ConfigService.get() retrieves values from the configuration factory or environment
    const maxClinicsEnv = process.env['MAX_CLINICS'];
    const maxLocationsEnv = process.env['MAX_LOCATIONS_PER_CLINIC'];
    
    this.maxClinics = maxClinicsEnv ? parseInt(maxClinicsEnv, 10) : 200; // Default: 200 clinics
    this.maxLocationsPerClinic = maxLocationsEnv ? parseInt(maxLocationsEnv, 10) : 50; // Default: 50 locations per clinic
  }

  async onModuleInit() {
    await this.initializeClinicCaching();
    this.startCacheRefresh();
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.INFO,
      'Clinic isolation service initialized',
      this.serviceName
    );
  }

  /**
   * Initialize clinic caching system
   */
  async initializeClinicCaching(): Promise<void> {
    try {
      // Clear existing caches
      this.clinicCache.clear();
      this.userClinicCache.clear();
      this.locationClinicCache.clear();

      // Load all active clinics - use internal accessor
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
      ).getInternalPrismaClient();
      type ClinicDelegate = {
        findMany: <T>(args: T) => Promise<
          Array<{
            id: string;
            name: string;
            subdomain?: string | null;
            locations?: Array<{ id: string }>;
            _count?: { users?: number; appointments?: number };
          }>
        >;
      };
      const clinicDelegate = prismaClient.clinic as ClinicDelegate;
      const rawClinics = await clinicDelegate.findMany({
        where: { isActive: true },
        include: {
          locations: {
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              users: true,
              appointments: true,
            },
          },
        },
      });
      const clinics = rawClinics as Array<{
        id: string;
        name: string;
        subdomain: string | null;
        app_name: string;
        isActive: boolean;
        locations: Array<{ id: string }>;
      }>;

      for (const clinic of clinics) {
        const clinicContext: ClinicContext = {
          clinicId: clinic.id,
          clinicName: clinic.name,
          ...(clinic.subdomain && { subdomain: clinic.subdomain }),
          appName: clinic.app_name,
          locations: clinic.locations.map(loc => loc.id),
          isActive: clinic.isActive,
          features: this.getClinicFeatures({
            telemedicineEnabled: (clinic as { telemedicineEnabled?: boolean }).telemedicineEnabled,
            labIntegrationEnabled: (clinic as { labIntegrationEnabled?: boolean })
              .labIntegrationEnabled,
            pharmacyIntegrationEnabled: (
              clinic as {
                pharmacyIntegrationEnabled?: boolean;
              }
            ).pharmacyIntegrationEnabled,
          }),
          settings: this.getClinicSettings({
            timezone: (clinic as { timezone?: string }).timezone,
            workingHours: (clinic as { workingHours?: string }).workingHours,
            appointmentDuration: (clinic as { appointmentDuration?: number }).appointmentDuration,
            maxAdvanceBooking: (clinic as { maxAdvanceBooking?: number }).maxAdvanceBooking,
            emergencyContact: (clinic as { emergencyContact?: string }).emergencyContact,
            dataRetention: (clinic as { dataRetention?: string }).dataRetention,
          }),
        };

        this.clinicCache.set(clinic.id, clinicContext);

        // Cache location to clinic mappings
        for (const location of clinic.locations) {
          this.locationClinicCache.set(location.id, clinic.id);
        }
      }

      // Load user-clinic mappings
      await this.loadUserClinicMappings();

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Initialized clinic cache with ${this.clinicCache.size} clinics and ${this.locationClinicCache.size} locations`,
        this.serviceName
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to initialize clinic caching: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      if (error instanceof HealthcareError) {
        throw error;
      }
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        `Failed to initialize clinic caching: ${(error as Error).message}`,
        undefined,
        { originalError: (error as Error).message },
        this.serviceName
      );
    }
  }

  /**
   * Get clinic context
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async getClinicContext(clinicId: string): Promise<ClinicIsolationResult<ClinicContext>> {
    try {
      // Check cache first
      let clinicContext = this.clinicCache.get(clinicId);

      if (!clinicContext) {
        // If not in cache, try to load from database
        // Use internal accessor - ClinicIsolationService is infrastructure component
        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type ClinicDelegate = {
          findFirst: <T>(args: T) => Promise<{
            id: string;
            name: string;
            subdomain?: string | null;
            locations?: Array<{ id: string }>;
          } | null>;
        };
        const clinicDelegate = prismaClient.clinic as ClinicDelegate;
        const rawClinic = await clinicDelegate.findFirst({
          where: {
            id: clinicId,
            isActive: true,
          },
          include: {
            locations: {
              select: {
                id: true,
              },
            },
          },
        });
        const clinic = rawClinic as {
          id: string;
          name: string;
          subdomain: string | null;
          app_name: string;
          isActive: boolean;
          locations: Array<{ id: string }>;
          telemedicineEnabled?: boolean;
          labIntegrationEnabled?: boolean;
          pharmacyIntegrationEnabled?: boolean;
          timezone?: string;
          workingHours?: string;
          appointmentDuration?: number;
          maxAdvanceBooking?: number;
          emergencyContact?: string;
          dataRetention?: string;
        } | null;

        if (!clinic) {
          return {
            success: false,
            error: `Clinic not found or inactive: ${clinicId}`,
          };
        }

        clinicContext = {
          clinicId: clinic.id,
          clinicName: clinic.name,
          ...(clinic.subdomain && { subdomain: clinic.subdomain }),
          appName: clinic.app_name,
          locations: clinic.locations.map(loc => loc.id),
          isActive: clinic.isActive,
          features: this.getClinicFeatures({
            telemedicineEnabled: clinic.telemedicineEnabled ?? undefined,
            labIntegrationEnabled: clinic.labIntegrationEnabled ?? undefined,
            pharmacyIntegrationEnabled: clinic.pharmacyIntegrationEnabled ?? undefined,
          }),
          settings: this.getClinicSettings({
            timezone: clinic.timezone ?? undefined,
            workingHours: clinic.workingHours ?? undefined,
            appointmentDuration: clinic.appointmentDuration ?? undefined,
            maxAdvanceBooking: clinic.maxAdvanceBooking ?? undefined,
            emergencyContact: clinic.emergencyContact ?? undefined,
            dataRetention: clinic.dataRetention ?? undefined,
          }),
        };

        // Cache for future use
        this.clinicCache.set(clinicId, clinicContext);
      }

      if (!clinicContext) {
        return {
          success: false,
          error: `Clinic not found: ${clinicId}`,
        };
      }

      return {
        success: true,
        data: clinicContext,
        clinicContext,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to get clinic context for ${clinicId}: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Validate clinic access for a user
   */
  async validateClinicAccess(
    userId: string,
    clinicId: string
  ): Promise<ClinicIsolationResult<boolean>> {
    try {
      // Check if clinic exists and is active
      const clinicResult = await this.getClinicContext(clinicId);
      if (!clinicResult.success) {
        return {
          success: false,
          ...(clinicResult.error && { error: clinicResult.error }),
          data: false,
        };
      }

      // Check if user has access to this clinic
      const userClinics = this.userClinicCache.get(userId);
      if (!userClinics || !userClinics.includes(clinicId)) {
        // Load from database if not in cache
        // Use internal accessor - ClinicIsolationService is infrastructure component
        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type UserDelegate = {
          findFirst: <T>(args: T) => Promise<{
            id: string;
            primaryClinicId?: string | null;
            clinics?: Array<{ id: string }>;
          } | null>;
        };
        const userDelegate = prismaClient.user as UserDelegate;
        const rawUserClinicAccess = await userDelegate.findFirst({
          where: {
            id: userId,
            OR: [
              { primaryClinicId: clinicId }, // Primary clinic assignment
              {
                clinics: {
                  some: {
                    id: clinicId,
                  },
                },
              }, // Many-to-many clinic association
            ],
          },
          select: {
            id: true,
          },
        });
        const userClinicAccess = rawUserClinicAccess as { id: string } | null;

        if (!userClinicAccess) {
          return {
            success: false,
            error: `User ${userId} does not have access to clinic ${clinicId}`,
            ...(clinicResult.data && { clinicContext: clinicResult.data }),
          };
        }

        // Update cache
        const currentClinics = this.userClinicCache.get(userId) || [];
        if (!currentClinics.includes(clinicId)) {
          currentClinics.push(clinicId);
          this.userClinicCache.set(userId, currentClinics);
        }
      }

      return {
        success: true,
        data: true,
        ...(clinicResult.data && { clinicContext: clinicResult.data }),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to validate clinic access for user ${userId}, clinic ${clinicId}: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Set current clinic context for database operations
   */
  setCurrentClinicContext(clinicId: string): void {
    // Set clinic ID for row-level security
    // Note: Tenant ID setting should be handled via DatabaseService if needed
    // For now, clinic isolation is handled via context in queries
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `Set clinic context to: ${clinicId}`,
      this.serviceName
    );
  }

  /**
   * Clear clinic context
   */
  clearClinicContext(): void {
    // Note: Tenant ID clearing should be handled via DatabaseService if needed
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      'Cleared clinic context',
      this.serviceName
    );
  }

  /**
   * Get clinics accessible by user
   */
  async getUserClinics(userId: string): Promise<ClinicIsolationResult<ClinicContext[]>> {
    try {
      let userClinics = this.userClinicCache.get(userId);

      if (!userClinics) {
        // Load from database
        // Use internal accessor - ClinicIsolationService is infrastructure component
        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type UserDelegate = {
          findUnique: <T>(args: T) => Promise<{
            id: string;
            primaryClinicId?: string | null;
            clinics?: Array<{ id: string }>;
          } | null>;
        };
        const userDelegate = prismaClient.user as UserDelegate;
        const rawUser = await userDelegate.findUnique({
          where: { id: userId },
          include: {
            primaryClinic: {
              select: {
                id: true,
              },
            },
            clinics: {
              select: {
                id: true,
              },
            },
          },
        });
        const user = rawUser as {
          id: string;
          primaryClinic: { id: string } | null;
          clinics: Array<{ id: string }>;
        } | null;

        if (!user) {
          return {
            success: false,
            error: `User not found: ${userId}`,
          };
        }

        const clinicIds = new Set<string>();

        // Add primary clinic
        if (user.primaryClinic) {
          clinicIds.add(user.primaryClinic.id);
        }

        // Add associated clinics
        for (const clinic of user.clinics) {
          clinicIds.add(clinic.id);
        }

        userClinics = Array.from(clinicIds);
        this.userClinicCache.set(userId, userClinics);
      }

      const clinicContexts = userClinics
        .map(clinicId => this.clinicCache.get(clinicId))
        .filter(context => context && context.isActive) as ClinicContext[];

      return {
        success: true,
        data: clinicContexts,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to get user clinics for ${userId}: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get clinic by location ID
   */
  async getClinicByLocation(locationId: string): Promise<ClinicIsolationResult<ClinicContext>> {
    try {
      let clinicId = this.locationClinicCache.get(locationId);

      if (!clinicId) {
        // Load from database
        // Use internal accessor - ClinicIsolationService is infrastructure component
        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type ClinicLocationDelegate = {
          findUnique: <T>(args: T) => Promise<{
            id: string;
            clinic: { id: string } | null;
          } | null>;
        };
        type PrismaClientWithLocation = {
          clinicLocation: ClinicLocationDelegate;
        };
        const clinicLocationDelegate = (prismaClient as unknown as PrismaClientWithLocation)[
          'clinicLocation'
        ];
        const rawResult = await clinicLocationDelegate.findUnique({
          where: { id: locationId },
          include: {
            clinic: {
              select: {
                id: true,
              },
            },
          },
        });
        const location = rawResult as {
          id: string;
          clinic: { id: string } | null;
        } | null;

        if (!location || !location.clinic) {
          return {
            success: false,
            error: `Location not found or not associated with clinic: ${locationId}`,
          };
        }

        clinicId = location.clinic.id;
        this.locationClinicCache.set(locationId, clinicId);
      }

      if (!clinicId) {
        return {
          success: false,
          error: 'Clinic ID not found',
        };
      }

      return this.getClinicContext(clinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to get clinic by location ${locationId}: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute operation with clinic context
   * INTERNAL: Only accessible by HealthcareDatabaseClient
   * @internal
   */
  // Public for HealthcareDatabaseClient access, but marked as internal
  async executeWithClinicContext<T>(
    clinicId: string,
    operation: () => Promise<T>
  ): Promise<ClinicIsolationResult<T>> {
    try {
      // Validate clinic
      const clinicResult = await this.getClinicContext(clinicId);
      if (!clinicResult.success) {
        return clinicResult as ClinicIsolationResult<T>;
      }

      // Set clinic context
      this.setCurrentClinicContext(clinicId);

      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          ...(clinicResult.data && { clinicContext: clinicResult.data }),
        };
      } finally {
        // Always clear context after operation
        this.clearClinicContext();
      }
    } catch (error) {
      this.clearClinicContext();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to execute operation with clinic context ${clinicId}: ${(error as Error).message}`,
        this.serviceName,
        { error: (error as Error).stack }
      );
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async loadUserClinicMappings(): Promise<void> {
    // Use internal accessor - ClinicIsolationService is infrastructure component
    const prismaClient = (
      this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
    ).getInternalPrismaClient();
    type UserDelegate = {
      findMany: <T>(args: T) => Promise<
        Array<{
          id: string;
          primaryClinicId?: string | null;
          clinics?: Array<{ id: string }>;
        }>
      >;
    };
    const userDelegate = prismaClient.user as UserDelegate;
    const rawUsers = await userDelegate.findMany({
      select: {
        id: true,
        primaryClinicId: true,
        clinics: {
          select: {
            id: true,
          },
        },
      },
    });
    const users = rawUsers as Array<{
      id: string;
      primaryClinicId: string | null;
      clinics: Array<{ id: string }>;
    }>;

    for (const user of users) {
      const clinicIds = new Set<string>();

      if (user.primaryClinicId) {
        clinicIds.add(user.primaryClinicId);
      }

      for (const clinic of user.clinics) {
        clinicIds.add(clinic.id);
      }

      if (clinicIds.size > 0) {
        this.userClinicCache.set(user.id, Array.from(clinicIds));
      }
    }
  }

  private getClinicFeatures(clinic: {
    telemedicineEnabled?: boolean | undefined;
    labIntegrationEnabled?: boolean | undefined;
    pharmacyIntegrationEnabled?: boolean | undefined;
  }): string[] {
    // Extract clinic-specific features based on clinic configuration
    const features = ['appointment_scheduling', 'patient_management', 'medical_records', 'billing'];

    // Add conditional features based on clinic settings
    if (clinic.telemedicineEnabled === true) features.push('telemedicine');
    if (clinic.labIntegrationEnabled === true) features.push('lab_integration');
    if (clinic.pharmacyIntegrationEnabled === true) features.push('pharmacy_integration');

    return features;
  }

  private getClinicSettings(clinic: {
    timezone?: string | undefined;
    workingHours?: string | undefined;
    appointmentDuration?: number | undefined;
    maxAdvanceBooking?: number | undefined;
    emergencyContact?: string | undefined;
    dataRetention?: string | undefined;
  }): Record<string, string | number | boolean> {
    return {
      timezone: clinic.timezone ?? 'UTC',
      workingHours: clinic.workingHours ?? '09:00-17:00',
      appointmentDuration: clinic.appointmentDuration ?? 30,
      maxAdvanceBooking: clinic.maxAdvanceBooking ?? 30,
      emergencyContact: clinic.emergencyContact ?? '',
      hipaaCompliance: true,
      dataRetention: clinic.dataRetention ?? '7_years',
    };
  }

  private startCacheRefresh(): void {
    // Refresh cache every 5 minutes
    this.cacheUpdateInterval = setInterval(
      () => {
        void (async () => {
          try {
            await this.initializeClinicCaching();
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.DEBUG,
              'Clinic cache refreshed',
              this.serviceName
            );
          } catch (error) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.ERROR,
              `Failed to refresh clinic cache: ${(error as Error).message}`,
              this.serviceName,
              { error: (error as Error).stack }
            );
          }
        })();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Get cache performance metrics
   */
  getCacheMetrics(): {
    hitRate: number;
    missRate: number;
    totalHits: number;
    totalMisses: number;
    cacheSize: number;
  } {
    const totalRequests = this.cacheHitCount + this.cacheMissCount;
    const hitRate = totalRequests > 0 ? (this.cacheHitCount / totalRequests) * 100 : 0;
    const missRate = totalRequests > 0 ? (this.cacheMissCount / totalRequests) * 100 : 0;

    return {
      hitRate,
      missRate,
      totalHits: this.cacheHitCount,
      totalMisses: this.cacheMissCount,
      cacheSize: this.clinicCache.size + this.userClinicCache.size + this.locationClinicCache.size,
    };
  }

  /**
   * Optimize cache by removing least recently used entries
   */
  private optimizeCache(): void {
    const totalSize =
      this.clinicCache.size + this.userClinicCache.size + this.locationClinicCache.size;

    if (totalSize > this.MAX_CACHE_SIZE) {
      // Remove oldest entries from each cache
      const entriesToRemove = Math.floor(totalSize * 0.1); // Remove 10% of entries

      // Remove from clinic cache
      const clinicEntries = Array.from(this.clinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, clinicEntries.length); i++) {
        this.clinicCache.delete(clinicEntries[i] || '');
      }

      // Remove from user cache
      const userEntries = Array.from(this.userClinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, userEntries.length); i++) {
        this.userClinicCache.delete(userEntries[i] || '');
      }

      // Remove from location cache
      const locationEntries = Array.from(this.locationClinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, locationEntries.length); i++) {
        this.locationClinicCache.delete(locationEntries[i] || '');
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Cache optimized: removed ${entriesToRemove} entries`,
        this.serviceName
      );
    }
  }

  /**
   * Batch validate clinic access for multiple users
   */
  async batchValidateClinicAccess(
    userIds: string[],
    clinicId: string
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // Check cache first
    const uncachedUserIds: string[] = [];

    for (const userId of userIds) {
      const userClinics = this.userClinicCache.get(userId);
      if (userClinics) {
        results.set(userId, userClinics.includes(clinicId));
        this.cacheHitCount++;
      } else {
        uncachedUserIds.push(userId);
        this.cacheMissCount++;
      }
    }

    // Fetch uncached users from database
    if (uncachedUserIds.length > 0) {
      try {
        // Use internal accessor - ClinicIsolationService is infrastructure component
        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type UserDelegate = {
          findMany: <T>(args: T) => Promise<Array<{ id: string }>>;
        };
        const userDelegate = prismaClient.user as UserDelegate;
        const rawUsers = await userDelegate.findMany({
          where: {
            id: { in: uncachedUserIds },
            clinicAdmins: {
              some: { clinicId },
            },
          },
          select: { id: true },
        });
        const users = rawUsers as Array<{ id: string }>;

        const validUserIds = new Set(users.map(u => u.id));

        for (const userId of uncachedUserIds) {
          const hasAccess = validUserIds.has(userId);
          results.set(userId, hasAccess);
        }
      } catch (error) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Batch clinic access validation failed: ${(error as Error).message}`,
          this.serviceName,
          { error: (error as Error).stack }
        );
        // Set all uncached users to false on error
        for (const userId of uncachedUserIds) {
          results.set(userId, false);
        }
      }
    }

    return results;
  }

  /**
   * Get service health status
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    cacheMetrics: {
      hitRate: number;
      missRate: number;
      totalHits: number;
      totalMisses: number;
      cacheSize: number;
    };
    lastCacheRefresh: Date;
    totalClinics: number;
    totalUsers: number;
    totalLocations: number;
  } {
    const metrics = this.getCacheMetrics();
    const status = metrics.hitRate > 80 ? 'healthy' : metrics.hitRate > 60 ? 'warning' : 'critical';

    return {
      status,
      cacheMetrics: metrics,
      lastCacheRefresh: new Date(),
      totalClinics: this.clinicCache.size,
      totalUsers: this.userClinicCache.size,
      totalLocations: this.locationClinicCache.size,
    };
  }

  // Cleanup
  onModuleDestroy() {
    if (this.cacheUpdateInterval) {
      clearInterval(this.cacheUpdateInterval);
    }
  }
}
