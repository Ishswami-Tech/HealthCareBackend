import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

export interface ClinicContext {
  clinicId: string;
  clinicName: string;
  subdomain?: string;
  appName?: string;
  locations: string[];
  isActive: boolean;
  features: string[];
  settings: Record<string, any>;
}

export interface ClinicIsolationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  clinicContext?: ClinicContext;
}

/**
 * Clinic Isolation Service for Healthcare Multi-Clinic Architecture
 * Handles data isolation and routing between multiple clinics within single healthcare app
 */
@Injectable()
export class ClinicIsolationService implements OnModuleInit {
  private readonly logger = new Logger(ClinicIsolationService.name);
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
    private prismaService: PrismaService,
    private configService: ConfigService,
  ) {
    this.maxClinics = this.configService.get<number>('healthcare.multiClinic.maxClinicsPerApp', 200); // Optimized for 200 clinics
    this.maxLocationsPerClinic = this.configService.get<number>('healthcare.multiClinic.maxLocationsPerClinic', 50); // Optimized for 50 locations per clinic
  }

  async onModuleInit() {
    await this.initializeClinicCaching();
    this.startCacheRefresh();
    this.logger.log('Clinic isolation service initialized');
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

      // Load all active clinics
      const clinics = await this.prismaService.clinic.findMany({
        where: { isActive: true },
        include: {
          locations: true,
          _count: {
            select: { 
              users: true, 
              appointments: true
            }
          }
        }
      });

      for (const clinic of clinics) {
        const clinicContext: ClinicContext = {
          clinicId: clinic.id,
          clinicName: clinic.name,
          subdomain: clinic.subdomain || undefined,
          appName: clinic.app_name,
          locations: clinic.locations.map(loc => loc.id),
          isActive: clinic.isActive,
          features: this.getClinicFeatures(clinic),
          settings: this.getClinicSettings(clinic),
        };

        this.clinicCache.set(clinic.id, clinicContext);

        // Cache location to clinic mappings
        for (const location of clinic.locations) {
          this.locationClinicCache.set(location.id, clinic.id);
        }
      }

      // Load user-clinic mappings
      await this.loadUserClinicMappings();

      this.logger.log(`Initialized clinic cache with ${this.clinicCache.size} clinics and ${this.locationClinicCache.size} locations`);
    } catch (error) {
      this.logger.error(`Failed to initialize clinic caching: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get clinic context by clinic ID
   */
  async getClinicContext(clinicId: string): Promise<ClinicIsolationResult<ClinicContext>> {
    try {
      // Check cache first
      let clinicContext = this.clinicCache.get(clinicId);
      
      if (!clinicContext) {
        // If not in cache, try to load from database
        const clinic = await this.prismaService.clinic.findFirst({
          where: { 
            id: clinicId, 
            isActive: true 
          },
          include: {
            locations: true
          }
        });

        if (!clinic) {
          return {
            success: false,
            error: `Clinic not found or inactive: ${clinicId}`
          };
        }

        clinicContext = {
          clinicId: clinic.id,
          clinicName: clinic.name,
          subdomain: clinic.subdomain || undefined,
          appName: clinic.app_name,
          locations: clinic.locations.map(loc => loc.id),
          isActive: clinic.isActive,
          features: this.getClinicFeatures(clinic),
          settings: this.getClinicSettings(clinic),
        };

        // Cache for future use
        this.clinicCache.set(clinicId, clinicContext!);
      }

      return {
        success: true,
        data: clinicContext,
        clinicContext
      };
    } catch (error) {
      this.logger.error(`Failed to get clinic context for ${clinicId}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Validate clinic access for a user
   */
  async validateClinicAccess(userId: string, clinicId: string): Promise<ClinicIsolationResult<boolean>> {
    try {
      // Check if clinic exists and is active
      const clinicResult = await this.getClinicContext(clinicId);
      if (!clinicResult.success) {
        return {
          success: false,
          error: clinicResult.error,
          data: false
        };
      }

      // Check if user has access to this clinic
      const userClinics = this.userClinicCache.get(userId);
      if (!userClinics || !userClinics.includes(clinicId)) {
        // Load from database if not in cache
        const userClinicAccess = await this.prismaService.user.findFirst({
          where: { 
            id: userId,
            OR: [
              { primaryClinicId: clinicId }, // Primary clinic assignment
              { 
                clinics: {
                  some: {
                    id: clinicId
                  }
                }
              } // Many-to-many clinic association
            ]
          }
        });

        if (!userClinicAccess) {
          return {
            success: false,
            error: `User ${userId} does not have access to clinic ${clinicId}`,
            clinicContext: clinicResult.data
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
        clinicContext: clinicResult.data
      };
    } catch (error) {
      this.logger.error(`Failed to validate clinic access for user ${userId}, clinic ${clinicId}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Set current clinic context for database operations
   */
  setCurrentClinicContext(clinicId: string): void {
    // Set clinic ID for row-level security
    this.prismaService.setCurrentTenantId(clinicId);
    this.logger.debug(`Set clinic context to: ${clinicId}`);
  }

  /**
   * Clear clinic context
   */
  clearClinicContext(): void {
    this.prismaService.clearTenantId();
    this.logger.debug('Cleared clinic context');
  }

  /**
   * Get clinics accessible by user
   */
  async getUserClinics(userId: string): Promise<ClinicIsolationResult<ClinicContext[]>> {
    try {
      let userClinics = this.userClinicCache.get(userId);
      
      if (!userClinics) {
        // Load from database
        const user = await this.prismaService.user.findUnique({
          where: { id: userId },
          include: {
            primaryClinic: true,
            clinics: true
          }
        });

        if (!user) {
          return {
            success: false,
            error: `User not found: ${userId}`
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
        data: clinicContexts
      };
    } catch (error) {
      this.logger.error(`Failed to get user clinics for ${userId}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
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
        const location = await this.prismaService.clinicLocation.findUnique({
          where: { id: locationId },
          include: { clinic: true }
        });

        if (!location || !location.clinic) {
          return {
            success: false,
            error: `Location not found or not associated with clinic: ${locationId}`
          };
        }

        clinicId = location.clinic.id;
        this.locationClinicCache.set(locationId, clinicId);
      }

      return this.getClinicContext(clinicId);
    } catch (error) {
      this.logger.error(`Failed to get clinic by location ${locationId}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Execute database operation with clinic context
   */
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
          clinicContext: clinicResult.data
        };
      } finally {
        // Always clear context after operation
        this.clearClinicContext();
      }
    } catch (error) {
      this.clearClinicContext();
      this.logger.error(`Failed to execute operation with clinic context ${clinicId}: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  private async loadUserClinicMappings(): Promise<void> {
    const users = await this.prismaService.user.findMany({
      select: {
        id: true,
        primaryClinicId: true,
        clinics: {
          select: {
            id: true
          }
        }
      }
    });

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

  private getClinicFeatures(clinic: any): string[] {
    // Extract clinic-specific features based on clinic configuration
    const features = [
      'appointment_scheduling',
      'patient_management',
      'medical_records',
      'billing'
    ];

    // Add conditional features based on clinic settings
    if (clinic.telemedicineEnabled) features.push('telemedicine');
    if (clinic.labIntegrationEnabled) features.push('lab_integration');
    if (clinic.pharmacyIntegrationEnabled) features.push('pharmacy_integration');

    return features;
  }

  private getClinicSettings(clinic: any): Record<string, any> {
    return {
      timezone: clinic.timezone || 'UTC',
      workingHours: clinic.workingHours || '09:00-17:00',
      appointmentDuration: clinic.appointmentDuration || 30,
      maxAdvanceBooking: clinic.maxAdvanceBooking || 30,
      emergencyContact: clinic.emergencyContact,
      hipaaCompliance: true,
      dataRetention: clinic.dataRetention || '7_years'
    };
  }

  private startCacheRefresh(): void {
    // Refresh cache every 5 minutes
    this.cacheUpdateInterval = setInterval(async () => {
      try {
        await this.initializeClinicCaching();
        this.logger.debug('Clinic cache refreshed');
      } catch (error) {
        this.logger.error(`Failed to refresh clinic cache: ${(error as Error).message}`);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Get cache performance metrics
   */
  getCacheMetrics(): {
    hitRate: number;
    totalRequests: number;
    cacheSize: number;
    clinicCacheSize: number;
    userCacheSize: number;
    locationCacheSize: number;
  } {
    const totalRequests = this.cacheHitCount + this.cacheMissCount;
    const hitRate = totalRequests > 0 ? (this.cacheHitCount / totalRequests) * 100 : 0;
    
    return {
      hitRate,
      totalRequests,
      cacheSize: this.clinicCache.size + this.userClinicCache.size + this.locationClinicCache.size,
      clinicCacheSize: this.clinicCache.size,
      userCacheSize: this.userClinicCache.size,
      locationCacheSize: this.locationClinicCache.size,
    };
  }

  /**
   * Optimize cache by removing least recently used entries
   */
  private optimizeCache(): void {
    const totalSize = this.clinicCache.size + this.userClinicCache.size + this.locationClinicCache.size;
    
    if (totalSize > this.MAX_CACHE_SIZE) {
      // Remove oldest entries from each cache
      const entriesToRemove = Math.floor(totalSize * 0.1); // Remove 10% of entries
      
      // Remove from clinic cache
      const clinicEntries = Array.from(this.clinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, clinicEntries.length); i++) {
        this.clinicCache.delete(clinicEntries[i]);
      }
      
      // Remove from user cache
      const userEntries = Array.from(this.userClinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, userEntries.length); i++) {
        this.userClinicCache.delete(userEntries[i]);
      }
      
      // Remove from location cache
      const locationEntries = Array.from(this.locationClinicCache.keys());
      for (let i = 0; i < Math.min(entriesToRemove / 3, locationEntries.length); i++) {
        this.locationClinicCache.delete(locationEntries[i]);
      }
      
      this.logger.debug(`Cache optimized: removed ${entriesToRemove} entries`);
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
        const users = await this.prismaService.user.findMany({
          where: {
            id: { in: uncachedUserIds },
            clinicAdmins: {
              some: { clinicId }
            }
          },
          select: { id: true }
        });
        
        const validUserIds = new Set(users.map(u => u.id));
        
        for (const userId of uncachedUserIds) {
          const hasAccess = validUserIds.has(userId);
          results.set(userId, hasAccess);
        }
      } catch (error) {
        this.logger.error('Batch clinic access validation failed:', error);
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
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    cacheMetrics: any;
    lastCacheRefresh: Date;
    totalClinics: number;
    totalUsers: number;
    totalLocations: number;
  }> {
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