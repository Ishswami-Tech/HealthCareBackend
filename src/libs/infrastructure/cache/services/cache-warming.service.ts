import { Injectable, OnModuleInit, Optional, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
// IMPORTANT: avoid importing from the @config barrel in infra boot code (SWC TDZ/cycles).
import { ConfigService } from '@config/config.service';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { DatabaseService } from '@infrastructure/database/database.service';
import { QueueService } from '@infrastructure/queue';
import { LogType, LogLevel } from '@core/types';
import type { LoggerLike } from '@core/types';

/**
 * Comprehensive Cache Warming Service
 *
 * Pre-populates cache with frequently accessed data to improve performance.
 * Optimized for 10M+ users by warming popular caches before peak usage.
 *
 * @see https://docs.nestjs.com/techniques/task-scheduling - NestJS scheduling
 */
@Injectable()
export class CacheWarmingService implements OnModuleInit {
  private readonly serviceName = 'CacheWarmingService';
  private isWarmingInProgress = false;

  constructor(
    @Inject('CACHE_SERVICE')
    private readonly cacheService: CacheService,
    @Inject('DATABASE_SERVICE')
    private readonly databaseService: DatabaseService,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggerLike,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Optional() private readonly queueService?: QueueService
  ) {}

  onModuleInit(): void {
    // Initial cache warming on startup (non-blocking)
    setImmediate(() => {
      void this.warmPopularCaches().catch(error => {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Initial cache warming failed',
          this.serviceName,
          { error: error instanceof Error ? error.message : String(error) }
        );
      });
    });
  }

  /**
   * Warm popular caches every 3 hours (increased frequency for better hit rates)
   * Runs at: 00:03,06,09,12,15,18,21 hours
   */
  @Cron('0 */3 * * *', {
    name: 'warm-popular-caches',
    timeZone: 'UTC',
  })
  async warmPopularCaches(): Promise<void> {
    if (this.isWarmingInProgress) {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Cache warming already in progress, skipping',
        this.serviceName
      );
      return;
    }

    this.isWarmingInProgress = true;
    const startTime = Date.now();

    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Starting comprehensive cache warming',
        this.serviceName
      );

      // Get clinics with high load (active clinics)
      const activeClinics = await this.getActiveClinics();

      // Option 1: Direct warming (synchronous, immediate)
      // Warm caches in parallel (but limit concurrency to avoid overwhelming system)
      const warmingPromises: Promise<void>[] = [];
      const concurrencyLimit = 10; // Process 10 clinics at a time

      for (let i = 0; i < activeClinics.length; i += concurrencyLimit) {
        const batch = activeClinics.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(clinicId => this.warmClinicCaches(clinicId));
        warmingPromises.push(...batchPromises);

        // Wait for batch to complete before starting next batch
        await Promise.allSettled(batchPromises);
      }

      // Also warm frequently accessed data: user permissions, roles, and system data
      await this.warmFrequentlyAccessedData();

      // Option 2: Queue-based warming (asynchronous, non-blocking) - Use QueueService if available
      // This offloads heavy warming operations to background workers
      if (this.queueService && activeClinics.length > 50) {
        // For large numbers of clinics, use queue to avoid blocking
        try {
          await this.queueService.addBulkJobs(
            QueueService.ANALYTICS_QUEUE,
            activeClinics.map(clinicId => ({
              jobType: 'warm-clinic-cache',
              data: {
                clinicId,
                type: 'clinic_cache_warming',
              },
              options: {
                priority: QueueService.PRIORITIES.NORMAL,
                removeOnComplete: 100,
                removeOnFail: 50,
              },
            }))
          );

          await this.loggingService.log(
            LogType.CACHE,
            LogLevel.INFO,
            'Cache warming jobs queued for background processing',
            this.serviceName,
            {
              clinicsQueued: activeClinics.length,
              queue: QueueService.ANALYTICS_QUEUE,
            }
          );
        } catch (queueError) {
          // Fallback to direct warming if queue fails
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'Failed to queue cache warming jobs, using direct warming',
            this.serviceName,
            {
              error: queueError instanceof Error ? queueError.message : String(queueError),
            }
          );
        }
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Comprehensive cache warming completed',
        this.serviceName,
        {
          clinicsWarmed: activeClinics.length,
          duration: Date.now() - startTime,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Cache warming failed',
        this.serviceName,
        {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        }
      );
    } finally {
      this.isWarmingInProgress = false;
    }
  }

  /**
   * Warm doctor schedules for next 7 days
   * Runs daily at 2 AM UTC
   */
  @Cron('0 2 * * *', {
    name: 'warm-doctor-schedules',
    timeZone: 'UTC',
  })
  async warmDoctorSchedules(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Starting doctor schedule cache warming',
        this.serviceName
      );

      // Get active doctors
      const activeDoctors = await this.getActiveDoctors();

      // Warm schedules for next 7 days
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);

      // Option 1: Direct warming (for smaller sets)
      if (activeDoctors.length <= 100) {
        const warmingPromises = activeDoctors.map(doctorId =>
          this.warmDoctorSchedule(doctorId, startDate, endDate)
        );
        await Promise.allSettled(warmingPromises);
      } else {
        // Option 2: Queue-based warming (for large sets) - Use QueueService if available
        if (this.queueService) {
          try {
            await this.queueService.addBulkJobs(
              QueueService.ANALYTICS_QUEUE,
              activeDoctors.map(doctorId => ({
                jobType: 'warm-doctor-schedule',
                data: {
                  doctorId,
                  startDate: startDate.toISOString(),
                  endDate: endDate.toISOString(),
                  type: 'doctor_schedule_warming',
                },
                options: {
                  priority: QueueService.PRIORITIES.NORMAL,
                  removeOnComplete: 100,
                  removeOnFail: 50,
                },
              }))
            );

            await this.loggingService.log(
              LogType.CACHE,
              LogLevel.INFO,
              'Doctor schedule warming jobs queued for background processing',
              this.serviceName,
              {
                doctorsQueued: activeDoctors.length,
                queue: QueueService.ANALYTICS_QUEUE,
              }
            );
          } catch (queueError) {
            // Fallback to direct warming if queue fails
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              'Failed to queue doctor schedule warming, using direct warming',
              this.serviceName,
              {
                error: queueError instanceof Error ? queueError.message : String(queueError),
              }
            );

            // Fallback: Process in batches
            const batchSize = 50;
            for (let i = 0; i < activeDoctors.length; i += batchSize) {
              const batch = activeDoctors.slice(i, i + batchSize);
              const batchPromises = batch.map(doctorId =>
                this.warmDoctorSchedule(doctorId, startDate, endDate)
              );
              await Promise.allSettled(batchPromises);
            }
          }
        } else {
          // No queue service available, use direct warming in batches
          const batchSize = 50;
          for (let i = 0; i < activeDoctors.length; i += batchSize) {
            const batch = activeDoctors.slice(i, i + batchSize);
            const batchPromises = batch.map(doctorId =>
              this.warmDoctorSchedule(doctorId, startDate, endDate)
            );
            await Promise.allSettled(batchPromises);
          }
        }
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Doctor schedule cache warming completed',
        this.serviceName,
        {
          doctorsWarmed: activeDoctors.length,
          duration: Date.now() - startTime,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Doctor schedule cache warming failed',
        this.serviceName,
        {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        }
      );
    }
  }

  /**
   * Warm clinic-specific caches
   */
  private async warmClinicCaches(clinicId: string): Promise<void> {
    try {
      // Warm clinic info
      await this.cacheService.warmClinicCache(clinicId);

      // Warm clinic doctors list
      const keyFactory = this.cacheService.getKeyFactory();
      const doctorsKey = keyFactory.clinic(clinicId, 'doctors');

      // Fetch and cache doctors list (Doctor uses many-to-many relation with clinics via DoctorClinic)
      const doctors = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            doctor: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).doctor.findMany({
          where: {
            clinics: {
              some: {
                clinicId,
              },
            },
            isAvailable: true,
          },
          select: {
            id: true,
            userId: true,
            specialization: true,
          },
          take: 100, // Limit to top 100 doctors per clinic
        });
      });

      await this.cacheService.set(
        doctorsKey,
        doctors,
        14400 // Increased TTL to 4 hours for doctor profiles (better hit rate)
      );

      // Warm clinic locations
      const locationsKey = keyFactory.clinic(clinicId, 'locations');
      const locations = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            clinicLocation: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).clinicLocation.findMany({
          where: {
            clinicId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            address: true,
          },
        });
      });

      await this.cacheService.set(
        locationsKey,
        locations,
        28800 // Increased TTL to 8 hours for clinic data (better hit rate)
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to warm clinic caches for ${clinicId}`,
        this.serviceName,
        {
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Warm doctor schedule for date range
   */
  async warmDoctorSchedule(doctorId: string, startDate: Date, endDate: Date): Promise<void> {
    try {
      const keyFactory = this.cacheService.getKeyFactory();
      const dateKey = startDate.toISOString().split('T')[0] || '';
      const cacheKey = keyFactory.fromTemplate(
        'doctor:{doctorId}:clinic:{clinicId}:availability:{date}',
        {
          doctorId,
          clinicId: 'all', // Will be clinic-specific when called from context
          date: dateKey,
        }
      );

      // Check if already cached
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return; // Already warmed
      }

      // Fetch appointments for date range
      const appointments = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointment: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).appointment.findMany({
          where: {
            doctorId,
            date: {
              gte: startDate,
              lte: endDate,
            },
            status: {
              in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
            },
          },
          select: {
            id: true,
            date: true,
            time: true,
            duration: true,
            status: true,
          },
          orderBy: {
            date: 'asc',
          },
        });
      });

      // Cache for 3 hours (matches cron interval) - increased from 6 hours to match new warming frequency
      await this.cacheService.set(cacheKey, appointments, 10800);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to warm doctor schedule for ${doctorId}`,
        this.serviceName,
        {
          doctorId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Get active clinics (clinic with recent activity)
   */
  private async getActiveClinics(): Promise<string[]> {
    try {
      const clinics = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            clinic: {
              findMany: <T>(args: T) => Promise<Array<{ id: string }>>;
            };
          }
        ).clinic.findMany({
          where: {
            isActive: true,
          },
          select: {
            id: true,
          },
          take: 100, // Limit to top 100 active clinics
        });
      });

      return clinics.map(clinic => clinic.id);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to get active clinics for cache warming',
        this.serviceName,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Get active doctors
   */
  private async getActiveDoctors(): Promise<string[]> {
    try {
      const doctors = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            doctor: {
              findMany: <T>(args: T) => Promise<Array<{ id: string }>>;
            };
          }
        ).doctor.findMany({
          where: {
            isAvailable: true,
          },
          select: {
            id: true,
          },
          take: 500, // Limit to top 500 active doctors
        });
      });

      return doctors.map(doctor => doctor.id);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to get active doctors for cache warming',
        this.serviceName,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Warm frequently accessed data (user permissions, roles, system data)
   * This improves cache hit rates for RBAC and system lookups
   */
  private async warmFrequentlyAccessedData(): Promise<void> {
    try {
      const keyFactory = this.cacheService.getKeyFactory();

      // Warm system roles and permissions (critical for RBAC performance)
      const roles = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            rbacRole: {
              findMany: <T>(args: T) => Promise<Array<{ id: string; name: string }>>;
            };
          }
        ).rbacRole.findMany({
          where: {
            isActive: true,
            isSystemRole: true,
          },
          select: {
            id: true,
            name: true,
          },
          take: 50, // Limit to system roles
        });
      });

      // Warm role permissions cache for each system role
      for (const role of roles) {
        // Fetch and cache role permissions (this will be cached by RbacService.getRolePermissions)
        // We just trigger the cache by accessing it
        try {
          // This will populate the cache via RbacService
          await this.databaseService.findRolePermissionsSafe([role.id]);
        } catch {
          // Ignore errors - cache warming is best effort
        }
      }

      // Warm system permissions list
      const permissionsKey = keyFactory.fromTemplate('rbac:permissions:all', {});
      const permissions = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            permission: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).permission.findMany({
          where: {
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            resource: true,
            action: true,
          },
          take: 200, // Limit to most common permissions
        });
      });

      await this.cacheService.set(permissionsKey, permissions, 14400); // 4 hours TTL

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Frequently accessed data cache warming completed',
        this.serviceName,
        {
          rolesWarmed: roles.length,
          permissionsWarmed: permissions.length,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to warm frequently accessed data',
        this.serviceName,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Manual cache warming (can be called via API)
   */
  async warmCacheManually(clinicId?: string): Promise<{ success: boolean; message: string }> {
    try {
      if (clinicId) {
        await this.warmClinicCaches(clinicId);
        return {
          success: true,
          message: `Cache warmed for clinic ${clinicId}`,
        };
      }

      await this.warmPopularCaches();
      return {
        success: true,
        message: 'All popular caches warmed successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: `Cache warming failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
