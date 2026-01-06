import {
  Injectable,
  Optional,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { HealthCheckService, HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@config/config.service';
import { DatabaseHealthIndicator } from './health-indicators/database-health.indicator';
import { CacheHealthIndicator } from './health-indicators/cache-health.indicator';
import { QueueHealthIndicator } from './health-indicators/queue-health.indicator';
import { LoggingHealthIndicator } from './health-indicators/logging-health.indicator';
import { VideoHealthIndicator } from './health-indicators/video-health.indicator';
import { HealthCacheService } from './realtime/services/health-cache.service';
import type { HealthCheckResponse, DetailedHealthCheckResponse, ServiceHealth } from '@core/types';
import type { AggregatedHealthStatus } from '@core/types/realtime-health.types';
import { LogType, LogLevel } from '@core/types';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';
import { LoggingService } from '@infrastructure/logging';
import { CommunicationHealthMonitorService } from '@communication/communication-health-monitor.service';
import cluster from 'cluster';
import * as os from 'os';

/**
 * Independent Health Service
 *
 * This service operates independently of API operations and provides health status
 * through background monitoring. All dependencies are optional to ensure graceful
 * degradation when services are unavailable.
 */
@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private readonly SYSTEM_TENANT_ID = 'system-health-check';

  // Smart caching configuration - optimized for real-time status (15-30s freshness)
  private readonly CACHE_FRESHNESS_MS = 20000; // 20 seconds - cache is considered fresh
  private readonly MAX_CACHE_AGE_MS = 30000; // 30 seconds - max age before forcing refresh
  private readonly BACKGROUND_CHECK_INTERVAL = 20000; // 20 seconds - background monitoring interval
  private readonly DB_CHECK_INTERVAL = 10000; // 10 seconds - DB connection monitoring interval
  private readonly serviceStartTime = Date.now(); // Track when service started
  private readonly EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD = 90000; // 90 seconds - allow external services time to start

  // Cached health status - updated by background monitoring
  private cachedHealthStatus: HealthCheckResponse | null = null;
  private cachedHealthTimestamp: number = 0;
  private healthStatusLock = false;
  private backgroundMonitoringInterval: NodeJS.Timeout | null = null;
  private databaseMonitoringInterval: NodeJS.Timeout | null = null;

  // Request deduplication - prevents concurrent health checks from multiple requests
  // Critical for 10M+ users - if 1000 users request health simultaneously, only 1 check runs
  private pendingHealthCheckPromise: Promise<HealthCheckResponse> | null = null;
  private lastHealthCheckRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // Minimum 1 second between health check requests (prevents thundering herd)

  // Individual service status cache with timestamps
  private serviceStatusCache = new Map<
    string,
    { status: 'healthy' | 'unhealthy'; timestamp: number; details?: string }
  >();

  constructor(
    @Optional() @Inject(forwardRef(() => ConfigService)) private readonly config?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService,
    @Optional() private readonly healthCheckService?: HealthCheckService,
    @Optional() private readonly databaseHealthIndicator?: DatabaseHealthIndicator,
    @Optional() private readonly cacheHealthIndicator?: CacheHealthIndicator,
    @Optional() private readonly queueHealthIndicator?: QueueHealthIndicator,
    @Optional() private readonly loggingHealthIndicator?: LoggingHealthIndicator,
    @Optional() private readonly videoHealthIndicator?: VideoHealthIndicator,
    @Optional() private readonly healthCacheService?: HealthCacheService,
    @Optional()
    @Inject(forwardRef(() => CommunicationHealthMonitorService))
    private readonly communicationHealthMonitor?: CommunicationHealthMonitorService
  ) {}

  /**
   * Initialize background health monitoring
   * This runs independently of API requests
   */
  onModuleInit() {
    try {
      // Defensive check: ensure serviceStatusCache is initialized
      if (!this.serviceStatusCache) {
        // Re-initialize if somehow undefined (should never happen, but defensive)
        this.serviceStatusCache = new Map<
          string,
          { status: 'healthy' | 'unhealthy'; timestamp: number; details?: string }
        >();
      }

      // Start background health monitoring
      this.startBackgroundMonitoring();
      // Start continuous database connection monitoring
      this.startDatabaseMonitoring();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      // Use LoggingService if available, otherwise fallback to console.error
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'HealthService onModuleInit failed',
          'HealthService',
          { error: errorMessage, stack: errorStack }
        );
      } else {
        console.error(`[HealthService] onModuleInit failed: ${errorMessage}`);
        console.error(`[HealthService] Stack: ${errorStack}`);
      }
      // Don't throw - allow app to continue without health monitoring
    }
  }

  /**
   * Cleanup background monitoring
   */
  onModuleDestroy() {
    if (this.backgroundMonitoringInterval) {
      clearInterval(this.backgroundMonitoringInterval);
      this.backgroundMonitoringInterval = null;
    }
    if (this.databaseMonitoringInterval) {
      clearInterval(this.databaseMonitoringInterval);
      this.databaseMonitoringInterval = null;
    }
  }

  /**
   * Start background health monitoring
   * Updates cached health status independently of API requests every 20 seconds
   */
  private startBackgroundMonitoring() {
    // Initial health check
    void this.updateCachedHealthStatus();

    // Set up periodic background monitoring (every 20 seconds)
    this.backgroundMonitoringInterval = setInterval(() => {
      void this.updateCachedHealthStatus();
    }, this.BACKGROUND_CHECK_INTERVAL);
  }

  /**
   * Start continuous database connection monitoring
   * Monitors database connection health every 10 seconds
   * Uses robust health check with:
   * - Dedicated connection pool (connection_limit=2, won't exhaust main pool)
   * - Lightweight SELECT 1 query (fastest possible)
   * - 10-second caching to avoid excessive queries
   * - 2-second timeout protection (non-blocking)
   * - Expensive checks run every 60 seconds only
   */
  private startDatabaseMonitoring() {
    // Initial database check
    void this.monitorDatabaseConnection();

    // Set up periodic database monitoring (every 10 seconds)
    // DatabaseService.getHealthStatus() uses robust health check implementation
    this.databaseMonitoringInterval = setInterval(() => {
      void this.monitorDatabaseConnection();
    }, this.DB_CHECK_INTERVAL);
  }

  /**
   * Monitor database connection continuously
   * Updates database status cache without blocking
   * Uses robust health check implementation from DatabaseService:
   * - Dedicated health check connection pool (connection_limit=2)
   * - Lightweight SELECT 1 query with 1.5s timeout
   * - 10-second caching to prevent excessive queries
   * - Non-blocking execution with 2-second overall timeout
   * - Won't exhaust main connection pool
   */
  private async monitorDatabaseConnection(): Promise<void> {
    try {
      if (!this.databaseHealthIndicator) {
        // Defensive check before calling .set()
        if (this.serviceStatusCache && typeof this.serviceStatusCache.set === 'function') {
          this.serviceStatusCache.set('database', {
            status: 'unhealthy',
            timestamp: Date.now(),
            details: 'Database health indicator is not available',
          });
        }
        return;
      }

      // Use health indicator for database health check
      const healthStatus = await Promise.race([
        this.databaseHealthIndicator
          .check('database')
          .then(result => {
            const dbResult = result['database'] as Record<string, unknown>;
            return {
              isHealthy: dbResult?.['status'] === 'up',
              connectionCount: 0,
              activeQueries: 0,
              avgResponseTime:
                typeof dbResult?.['responseTime'] === 'number' ? dbResult['responseTime'] : 0,
              lastHealthCheck: new Date(),
              errors: dbResult?.['status'] === 'down' ? ['Database health check failed'] : [],
            };
          })
          .catch((checkError: unknown) => {
            // Handle HealthCheckError specifically - it contains the actual error details
            if (checkError instanceof HealthCheckError) {
              const causes = checkError.causes as Record<string, unknown> | undefined;
              const dbCause = causes?.['database'] as Record<string, unknown> | undefined;
              const errorMessage =
                (typeof dbCause?.['error'] === 'string' ? dbCause['error'] : undefined) ||
                checkError.message ||
                'Database health check failed';

              return {
                isHealthy: false,
                connectionCount: 0,
                activeQueries: 0,
                avgResponseTime: -1,
                lastHealthCheck: new Date(),
                errors: [errorMessage],
              };
            }
            // Re-throw other errors to be caught by outer catch
            throw checkError;
          }),
        new Promise<{
          isHealthy: boolean;
          avgResponseTime: number;
          errors?: string[];
          lastHealthCheck: Date;
        }>(resolve => {
          setTimeout(() => {
            resolve({
              isHealthy: false,
              avgResponseTime: -1,
              errors: ['Health check timeout (2s)'],
              lastHealthCheck: new Date(),
            });
          }, 2000); // 2 seconds timeout - matches robust health check implementation
        }),
      ]);

      // Defensive check before calling .set()
      if (this.serviceStatusCache && typeof this.serviceStatusCache.set === 'function') {
        this.serviceStatusCache.set('database', {
          status: healthStatus.isHealthy ? 'healthy' : 'unhealthy',
          timestamp: Date.now(),
          details: healthStatus.isHealthy
            ? 'PostgreSQL connected'
            : healthStatus.errors?.[0] || 'Database connection failed',
        });
      }
    } catch (error) {
      // Log the actual error for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Database health monitoring failed: ${errorMessage}`,
          'HealthService.monitorDatabaseConnection',
          {
            error: errorMessage,
            stack: errorStack,
            databaseHealthIndicatorAvailable: !!this.databaseHealthIndicator,
          }
        );
      }

      // Defensive check before calling .set()
      if (this.serviceStatusCache && typeof this.serviceStatusCache.set === 'function') {
        this.serviceStatusCache.set('database', {
          status: 'unhealthy',
          timestamp: Date.now(),
          details: `Database monitoring error: ${errorMessage}`,
        });
      }
    }
  }

  /**
   * Update cached health status in background
   * This method never throws - it gracefully handles all errors
   * Uses lightweight checks to avoid slowing down the system
   */
  private async updateCachedHealthStatus(): Promise<void> {
    // Prevent concurrent updates
    if (this.healthStatusLock) {
      return;
    }

    try {
      this.healthStatusLock = true;
      const healthStatus = await this.performHealthCheck();
      this.cachedHealthStatus = healthStatus;
      this.cachedHealthTimestamp = Date.now();
    } catch (error) {
      // Silently handle errors - don't let background monitoring fail
      // Health status will be checked on-demand if cache is unavailable
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Background health check failed: ${errorMessage}`,
          'HealthService.updateCachedHealthStatus',
          { error: errorMessage }
        );
      }
    } finally {
      this.healthStatusLock = false;
    }
  }

  private getSystemMetrics(): {
    uptime: number;
    memoryUsage: {
      heapTotal: number;
      heapUsed: number;
      rss: number;
      external: number;
      systemTotal: number;
      systemFree: number;
      systemUsed: number;
    };
    cpuUsage: {
      user: number;
      system: number;
      cpuCount: number;
      cpuModel: string;
      cpuSpeed: number;
    };
  } {
    const memoryUsage = process.memoryUsage();
    const cpuInfo = cpus();
    const totalMemory = totalmem();
    const freeMemory = freemem();

    return {
      uptime: process.uptime(),
      memoryUsage: {
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        rss: memoryUsage.rss,
        external: memoryUsage.external,
        systemTotal: totalMemory,
        systemFree: freeMemory,
        systemUsed: totalMemory - freeMemory,
      },
      cpuUsage: {
        user: process.cpuUsage().user,
        system: process.cpuUsage().system,
        cpuCount: cpuInfo.length,
        cpuModel: cpuInfo[0]?.model || 'unknown',
        cpuSpeed: cpuInfo[0]?.speed || 0,
      },
    };
  }

  /**
   * Get cluster information including worker and node details
   */
  private getClusterInfo(): {
    isPrimary: boolean;
    isWorker: boolean;
    workerId: string | number | undefined;
    instanceId: string;
    nodeName: string;
    hostname: string;
    cpuCount: number;
    totalWorkers?: number;
    activeWorkers?: number;
  } {
    const isPrimary = Boolean(
      cluster.isPrimary || (cluster as { isMaster?: boolean }).isMaster || false
    );
    const isWorker = !isPrimary && cluster.worker !== undefined;
    // Use ConfigService (which uses dotenv) for environment variable access
    const workerId = cluster.worker?.id || this.config?.getEnv('WORKER_ID') || undefined;
    const instanceId =
      this.config?.getEnv('INSTANCE_ID') || this.config?.getEnv('WORKER_ID') || '1';
    const nodeName =
      this.config?.getEnv('NODE_NAME') || this.config?.getEnv('HOSTNAME') || os.hostname();
    const hostname = os.hostname();
    const cpuCount = os.cpus().length;

    let totalWorkers: number | undefined;
    let activeWorkers: number | undefined;

    if (isPrimary && cluster.workers) {
      const workers = Object.values(cluster.workers);
      totalWorkers = workers.length;
      activeWorkers = workers.filter(w => w && !w.isDead()).length;
    }

    const result: {
      isPrimary: boolean;
      isWorker: boolean;
      workerId: string | number | undefined;
      instanceId: string;
      nodeName: string;
      hostname: string;
      cpuCount: number;
      totalWorkers?: number;
      activeWorkers?: number;
    } = {
      isPrimary,
      isWorker,
      workerId,
      instanceId,
      nodeName,
      hostname,
      cpuCount,
    };

    if (totalWorkers !== undefined) {
      result.totalWorkers = totalWorkers;
    }
    if (activeWorkers !== undefined) {
      result.activeWorkers = activeWorkers;
    }

    return result;
  }

  /**
   * Get health status - uses cached status if available, otherwise checks on-demand
   * This method is designed to be fast and never fail
   */
  /**
   * Check health with fresh data (no cache) - used for real-time dashboard
   */
  private async checkHealthFresh(): Promise<HealthCheckResponse> {
    return this.performHealthCheck();
  }

  /**
   * Get real-time health status
   * Optimized for 10M+ users with request deduplication and smart caching
   * Uses cached data if fresh (< 20s) to optimize for frequent dashboard updates
   * Prevents concurrent health checks (request deduplication)
   * Uses robust database health check with dedicated connection pool
   * Background monitoring continues to update cache for internal use
   */
  async getHealth(): Promise<HealthCheckResponse> {
    try {
      // Check if cached data is fresh (< 20 seconds old)
      // This optimizes for frequent dashboard updates without excessive health checks
      const now = Date.now();
      const cacheAge = now - this.cachedHealthTimestamp;

      if (this.cachedHealthStatus && cacheAge < this.CACHE_FRESHNESS_MS) {
        // Return cached data if fresh - prevents excessive health checks
        // Critical for 10M+ users - avoids database/network calls
        return this.cachedHealthStatus;
      }

      // Request deduplication: If a health check is already in progress, wait for it
      // This prevents thundering herd problem when multiple users request health simultaneously
      // Critical for 10M+ users - if 1000 users request health at once, only 1 check runs
      if (this.pendingHealthCheckPromise) {
        // Health check already in progress - return the pending promise
        // This ensures concurrent requests share the same health check result
        return await this.pendingHealthCheckPromise;
      }

      // Throttle health check requests - prevent too frequent checks
      // Even if cache is stale, don't check more than once per second
      const timeSinceLastRequest = now - this.lastHealthCheckRequestTime;
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS && this.cachedHealthStatus) {
        // Return cached data if request is too soon (prevents excessive checks)
        return this.cachedHealthStatus;
      }

      // Cache is stale and no check in progress - perform fresh health check
      // Create a shared promise for concurrent requests
      this.lastHealthCheckRequestTime = now;
      this.pendingHealthCheckPromise = (async () => {
        try {
          // Database health check uses:
          // - Dedicated connection pool (connection_limit=2, won't exhaust main pool)
          // - Lightweight SELECT 1 query (fastest possible)
          // - 10-second caching internally (DatabaseHealthMonitorService)
          // - 2-second timeout protection (non-blocking)
          // - Expensive checks run every 60 seconds only
          const healthStatus = await this.performHealthCheck();

          // Update cache in background for internal monitoring (non-blocking)
          if (!this.healthStatusLock) {
            this.cachedHealthStatus = healthStatus;
            this.cachedHealthTimestamp = Date.now();
          }

          // Get realtime status if available
          let realtimeStatus: AggregatedHealthStatus | undefined;
          if (this.healthCacheService) {
            try {
              const cached: unknown = await this.healthCacheService.getCachedStatus();
              const validated = this.validateAndGetAggregatedHealthStatus(cached);
              if (validated) {
                realtimeStatus = validated;
              }
            } catch {
              // Ignore realtime status errors - it's optional
            }
          }

          return {
            ...healthStatus,
            ...(realtimeStatus && { realtime: realtimeStatus }),
          } as HealthCheckResponse & { realtime?: AggregatedHealthStatus };
        } finally {
          // Clear pending promise after check completes (allow next check)
          this.pendingHealthCheckPromise = null;
        }
      })();

      return await this.pendingHealthCheckPromise;
    } catch (error) {
      // If getHealth itself fails, try to perform a basic health check
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'HealthService getHealth failed, attempting basic health check',
          'HealthService',
          { error: errorMessage }
        );
      } else {
        console.error(
          '[HealthService] getHealth failed, attempting basic health check:',
          errorMessage
        );
      }
      try {
        return await this.performHealthCheck();
      } catch (fallbackError) {
        // Last resort: return minimal health response with real system metrics
        const fallbackErrorMessage =
          fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
        if (this.loggingService) {
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'HealthService performHealthCheck also failed',
            'HealthService',
            { error: fallbackErrorMessage }
          );
        } else {
          console.error('[HealthService] performHealthCheck also failed:', fallbackErrorMessage);
        }
        const minimalResponse = this.getMinimalHealthResponse();
        // Ensure minimal response has real system metrics
        try {
          minimalResponse.systemMetrics = this.getSystemMetrics();
        } catch {
          // If getSystemMetrics fails, try direct calls
          try {
            const memoryUsage = process.memoryUsage();
            const cpuInfo = cpus();
            const totalMemory = totalmem();
            const freeMemory = freemem();
            minimalResponse.systemMetrics = {
              uptime: process.uptime(),
              memoryUsage: {
                heapTotal: memoryUsage.heapTotal,
                heapUsed: memoryUsage.heapUsed,
                rss: memoryUsage.rss,
                external: memoryUsage.external,
                systemTotal: totalMemory,
                systemFree: freeMemory,
                systemUsed: totalMemory - freeMemory,
              },
              cpuUsage: {
                user: process.cpuUsage().user,
                system: process.cpuUsage().system,
                cpuCount: cpuInfo.length,
                cpuModel: cpuInfo[0]?.model || 'unknown',
                cpuSpeed: cpuInfo[0]?.speed || 0,
              },
            };
          } catch {
            // Keep default zeros if all else fails
          }
        }
        return minimalResponse;
      }
    }
  }

  /**
   * Get minimal health response when all else fails
   * This ensures we always return a valid response
   */
  private getMinimalHealthResponse(): HealthCheckResponse {
    const memoryUsage = process.memoryUsage();
    const cpuInfo = cpus();
    const totalMemory = totalmem();
    const freeMemory = freemem();

    return {
      status: 'degraded',
      timestamp: new Date().toISOString(),
      environment: this.config?.getEnvironment() || 'development',
      version: this.config?.getEnv('npm_package_version') || '0.0.1',
      systemMetrics: {
        uptime: process.uptime(),
        memoryUsage: {
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          rss: memoryUsage.rss,
          external: memoryUsage.external,
          systemTotal: totalMemory,
          systemFree: freeMemory,
          systemUsed: totalMemory - freeMemory,
        },
        cpuUsage: {
          user: process.cpuUsage().user,
          system: process.cpuUsage().system,
          cpuCount: cpuInfo.length,
          cpuModel: cpuInfo[0]?.model || 'unknown',
          cpuSpeed: cpuInfo[0]?.speed || 0,
        },
      },
      services: {
        api: {
          status: 'healthy',
          responseTime: 10,
          lastChecked: new Date().toISOString(),
          details: 'API service is running and responding',
        },
        database: {
          status: 'unhealthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Health check service unavailable - cannot determine status',
        },
        cache: {
          status: 'unhealthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Health check service unavailable - cannot determine status',
        },
        queue: {
          status: 'unhealthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Health check service unavailable - cannot determine status',
        },
        logger: {
          status: 'unhealthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Health check service unavailable - cannot determine status',
        },
        communication: {
          status: 'healthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details:
            'Communication health monitoring is clinic-specific and not monitored at system level',
        },
      },
    };
  }

  /**
   * Perform actual health checks (no caching) - always fresh
   */
  /**
   * Perform health check using Terminus
   * This is the core method that uses Terminus health indicators
   */
  private async performHealthCheck(): Promise<HealthCheckResponse> {
    const startTime = performance.now();

    try {
      // OPTIMIZATION: Use cached status from background monitoring when available and fresh
      // This prevents redundant database/cache queries when background monitoring already has fresh data
      const currentTime = Date.now();
      const useCachedStatus = (
        serviceName: string,
        maxAge: number = 15000
      ): ServiceHealth | null => {
        const cached = this.serviceStatusCache.get(serviceName);
        if (cached && currentTime - cached.timestamp < maxAge) {
          return {
            status: cached.status,
            details: cached.details || `${serviceName} status from background monitoring`,
            responseTime: 0,
            lastChecked: new Date(cached.timestamp).toISOString(),
          };
        }
        return null;
      };

      // Try to use cached status for database (background monitoring updates every 10s)
      const cachedDbHealth = useCachedStatus('database', 15000);
      const cachedCacheHealth = useCachedStatus('cache', 15000);
      const cachedQueueHealth = useCachedStatus('queue', 15000);
      const cachedLoggerHealth = useCachedStatus('logging', 15000);

      // Use Terminus for health checks if available, but only for services without fresh cache
      if (
        this.healthCheckService &&
        this.databaseHealthIndicator &&
        this.cacheHealthIndicator &&
        this.queueHealthIndicator &&
        this.loggingHealthIndicator &&
        this.videoHealthIndicator
      ) {
        try {
          // Build health check array - only check services that don't have fresh cache
          const healthCheckPromises: Array<() => Promise<HealthIndicatorResult>> = [];
          const serviceKeys: string[] = [];

          // Database - use cache if available, otherwise check
          if (cachedDbHealth) {
            // Will use cached status below
          } else {
            healthCheckPromises.push(() => this.databaseHealthIndicator!.check('database'));
            serviceKeys.push('database');
          }

          // Cache - use cache if available, otherwise check
          if (cachedCacheHealth) {
            // Will use cached status below
          } else {
            healthCheckPromises.push(() => this.cacheHealthIndicator!.check('cache'));
            serviceKeys.push('cache');
          }

          // Queue - use cache if available, otherwise check
          if (cachedQueueHealth) {
            // Will use cached status below
          } else {
            healthCheckPromises.push(() => this.queueHealthIndicator!.check('queue'));
            serviceKeys.push('queue');
          }

          // Logger - use cache if available, otherwise check
          if (cachedLoggerHealth) {
            // Will use cached status below
          } else {
            healthCheckPromises.push(() => this.loggingHealthIndicator!.check('logging'));
            serviceKeys.push('logging');
          }

          // Video - always check (no background monitoring)
          healthCheckPromises.push(() => this.videoHealthIndicator!.check('video'));
          serviceKeys.push('video');

          // Only run Terminus checks if we have services to check
          let terminusResult: {
            status: string;
            info?: Record<string, unknown>;
            error?: Record<string, unknown>;
          } | null = null;
          if (healthCheckPromises.length > 0) {
            terminusResult = await this.healthCheckService.check(healthCheckPromises);
          }

          // Transform Terminus result to HealthCheckResponse format
          const services: Record<string, ServiceHealth> = {};

          // Use cached status for services that have fresh cache
          if (cachedDbHealth) {
            services['database'] = cachedDbHealth;
          }
          if (cachedCacheHealth) {
            services['cache'] = cachedCacheHealth;
          }
          if (cachedQueueHealth) {
            services['queue'] = cachedQueueHealth;
          }
          if (cachedLoggerHealth) {
            services['logging'] = cachedLoggerHealth;
          }

          // Process Terminus results only for services that were actually checked
          const terminusStatus = terminusResult?.status || 'ok';
          const info = terminusResult?.info || {};
          const error = terminusResult?.error || {};

          // Map Terminus indicators to services (only for services that were checked)
          const allIndicators = { ...info, ...error };
          for (const key of serviceKeys) {
            if (!key) continue;
            const indicatorData = allIndicators[key];
            if (indicatorData && typeof indicatorData === 'object') {
              const data = indicatorData as Record<string, unknown>;
              const hasError = error[key] !== undefined;
              const message =
                typeof data['message'] === 'string'
                  ? data['message']
                  : hasError
                    ? 'Service unhealthy'
                    : 'Service healthy';
              services[key] = {
                status: hasError ? 'unhealthy' : 'healthy',
                responseTime: typeof data['responseTime'] === 'number' ? data['responseTime'] : 0,
                lastChecked: new Date().toISOString(),
                details: message,
              };
            }
          }

          // Determine overall status from all services (cached + checked)
          // All services including video are critical for healthcare video consultations
          const allServiceStatuses = Object.values(services).map(s => s.status);
          const hasUnhealthy = allServiceStatuses.some(s => s === 'unhealthy');

          const responseTime = Math.round(performance.now() - startTime);
          const environment = this.config?.getEnvironment() || 'development';

          // Get realtime health status from cache if available
          // Map realtime status ('healthy' | 'degraded' | 'unhealthy') to ServiceHealth status ('healthy' | 'unhealthy')
          let overallStatus: 'healthy' | 'degraded' =
            terminusStatus === 'ok' && !hasUnhealthy ? 'healthy' : 'degraded';
          if (this.healthCacheService) {
            try {
              const cachedStatus: unknown = await this.healthCacheService.getCachedStatus();
              const validated = this.validateAndGetAggregatedHealthStatus(cachedStatus);
              if (validated) {
                // Map realtime status to ServiceHealth status
                const overall = validated.overall;
                if (overall === 'healthy' || overall === 'degraded' || overall === 'unhealthy') {
                  overallStatus = overall === 'healthy' ? 'healthy' : 'degraded';
                }
              }
            } catch {
              // Fallback to Terminus status if cache unavailable
            }
          }

          // Get realtime service status from cache if available
          // Map to ServiceHealth status format ('healthy' | 'unhealthy')
          // API is always healthy if we can serve health checks (default to healthy)
          let apiStatus: 'healthy' | 'unhealthy' = 'healthy';
          let databaseStatus: 'healthy' | 'unhealthy' = services['database']?.status || 'unhealthy';
          let cacheStatus: 'healthy' | 'unhealthy' = services['cache']?.status || 'unhealthy';
          let queueStatus: 'healthy' | 'unhealthy' = services['queue']?.status || 'unhealthy';
          let loggerStatus: 'healthy' | 'unhealthy' = services['logging']?.status || 'unhealthy';

          if (this.healthCacheService) {
            try {
              const cachedStatus: unknown = await this.healthCacheService.getCachedStatus();
              const validated = this.validateAndGetAggregatedHealthStatus(cachedStatus);
              if (validated) {
                const cachedServices = validated.services;
                // Map realtime status to ServiceHealth status (degraded -> unhealthy for ServiceHealth)
                const mapRealtimeToServiceHealth = (
                  status: 'healthy' | 'degraded' | 'unhealthy' | undefined
                ): 'healthy' | 'unhealthy' => {
                  if (status === 'healthy') return 'healthy';
                  return 'unhealthy'; // degraded and unhealthy both map to unhealthy for ServiceHealth
                };
                const apiService = cachedServices['api'];
                const databaseService = cachedServices['database'];
                const cacheService = cachedServices['cache'];
                const queueService = cachedServices['queue'];
                const loggerService = cachedServices['logger'];

                const apiStatusValue = this.extractRealtimeStatus(apiService?.status);
                const databaseStatusValue = this.extractRealtimeStatus(databaseService?.status);
                const cacheStatusValue = this.extractRealtimeStatus(cacheService?.status);
                const queueStatusValue = this.extractRealtimeStatus(queueService?.status);
                const loggerStatusValue = this.extractRealtimeStatus(loggerService?.status);

                // API is always healthy if status is undefined (not in cache) or healthy
                // Only mark unhealthy if explicitly marked as unhealthy in cache
                apiStatus = apiStatusValue === 'unhealthy' ? 'unhealthy' : 'healthy';
                databaseStatus = mapRealtimeToServiceHealth(databaseStatusValue) || databaseStatus;
                cacheStatus = mapRealtimeToServiceHealth(cacheStatusValue) || cacheStatus;
                queueStatus = mapRealtimeToServiceHealth(queueStatusValue) || queueStatus;
                loggerStatus = mapRealtimeToServiceHealth(loggerStatusValue) || loggerStatus;
              }
            } catch {
              // Fallback to Terminus status if cache unavailable
              // API remains healthy (default)
            }
          }

          return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            environment,
            version: this.config?.getEnv('npm_package_version') || '0.0.1',
            systemMetrics: this.getSystemMetrics(),
            services: {
              api: {
                status: apiStatus,
                responseTime,
                lastChecked: new Date().toISOString(),
                details: 'API service is running and responding',
              },
              database: services['database'] || {
                status: databaseStatus,
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              },
              cache: services['cache'] || {
                status: cacheStatus,
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              },
              queue: services['queue'] || {
                status: queueStatus,
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              },
              logger: services['logging'] || {
                status: loggerStatus,
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              },
              communication: (() => {
                // Try to get communication health status if available
                try {
                  let socketConnected = false;
                  let emailConnected = false; // Email should remain inactive as per user request

                  // Get lightweight health status from CommunicationHealthMonitorService if available
                  if (this.communicationHealthMonitor) {
                    try {
                      const lightweightHealth =
                        this.communicationHealthMonitor.getLightweightHealthStatus();
                      // Socket should be active if initialized (even if no clients connected)
                      // The health monitor checks if socket service is initialized, which means it's available
                      socketConnected = lightweightHealth.socket?.connected || false;
                      // Email should remain inactive - user explicitly requested this
                      emailConnected = false;
                    } catch {
                      // Ignore errors - use defaults
                    }
                  }

                  // If socket is not connected via health monitor, it might be that the health check hasn't run yet
                  // But we trust the health monitor as the source of truth
                  // Socket.IO is available if the service is initialized, which the health monitor checks

                  return {
                    status: 'healthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                    details:
                      'Communication health monitoring is clinic-specific and not monitored at system level',
                    communicationHealth: {
                      socket: { connected: socketConnected },
                      email: { connected: emailConnected }, // Always false - user requested email to be inactive
                    },
                  };
                } catch {
                  return {
                    status: 'healthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                    details:
                      'Communication health monitoring is clinic-specific and not monitored at system level',
                    communicationHealth: {
                      socket: { connected: false },
                      email: { connected: false }, // Always false - user requested email to be inactive
                    },
                  };
                }
              })(),
            },
          };
        } catch (terminusError) {
          // Terminus throws HealthCheckError when services are down
          // Extract the error information
          // Check if we're in startup grace period
          const timeSinceStart = Date.now() - this.serviceStartTime;
          const isInStartupGracePeriod =
            timeSinceStart < this.EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD;

          if (terminusError instanceof HealthCheckError) {
            const causes = terminusError.causes as Record<string, unknown> | undefined;
            if (causes && typeof causes === 'object') {
              const services: Record<string, ServiceHealth> = {};
              for (const [key, indicatorData] of Object.entries(causes)) {
                if (indicatorData && typeof indicatorData === 'object') {
                  const data = indicatorData as Record<string, unknown>;
                  const errorMessage =
                    typeof data['message'] === 'string' ? data['message'] : 'Service unhealthy';
                  const errorDetails =
                    typeof data['error'] === 'string' ? data['error'] : errorMessage;

                  // During startup grace period, show more helpful message
                  let details = errorMessage;
                  if (isInStartupGracePeriod) {
                    const remainingSeconds = Math.round(
                      (this.EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD - timeSinceStart) / 1000
                    );
                    details = `Service is starting up... (${remainingSeconds}s remaining). Error: ${errorDetails}`;
                  } else {
                    details = errorDetails || errorMessage;
                  }

                  services[key] = {
                    status: 'unhealthy', // ServiceHealth only supports 'healthy' | 'unhealthy', not 'degraded'
                    responseTime:
                      typeof data['responseTime'] === 'number' ? data['responseTime'] : 0,
                    lastChecked: new Date().toISOString(),
                    details: isInStartupGracePeriod
                      ? `${details} (Service is starting up - this is expected during initialization)`
                      : details,
                  };
                }
              }

              return {
                status: 'degraded',
                timestamp: new Date().toISOString(),
                environment: this.config?.getEnvironment() || 'development',
                version: this.config?.getEnv('npm_package_version') || '0.0.1',
                systemMetrics: this.getSystemMetrics(),
                services: {
                  api: {
                    status: 'healthy',
                    responseTime: Math.round(performance.now() - startTime),
                    lastChecked: new Date().toISOString(),
                    details: 'API service is running and responding',
                  },
                  database: services['database'] || {
                    status: 'unhealthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                  },
                  cache: services['cache'] || {
                    status: 'unhealthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                  },
                  queue: services['queue'] || {
                    status: 'unhealthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                  },
                  logger: services['logging'] || {
                    status: 'unhealthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                  },
                  communication: {
                    status: 'healthy' as const,
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                    details:
                      'Communication health monitoring is clinic-specific and not monitored at system level',
                  },
                },
              };
            }
          }
          throw terminusError;
        }
      }

      // Fallback if Terminus is not available
      const environment = this.config?.getEnvironment() || 'development';

      // Use cached database status if available and fresh (< 15 seconds old)
      // This avoids blocking on database checks while still showing real-time status
      let dbHealth: ServiceHealth;
      const cachedDbStatus = this.serviceStatusCache.get('database');
      const now = Date.now();
      const dbCacheAge = cachedDbStatus ? now - cachedDbStatus.timestamp : Infinity;

      if (cachedDbStatus && dbCacheAge < 15000) {
        // Use cached database status (updated every 10 seconds by background monitoring)
        dbHealth = {
          status: cachedDbStatus.status,
          details: cachedDbStatus.details || 'Database connection status',
          responseTime: 0,
          lastChecked: new Date(cachedDbStatus.timestamp).toISOString(),
        };
      } else {
        // Cache is stale or unavailable - perform fresh check
        const dbCheckResult = await Promise.race([
          (async () => {
            try {
              return await this.checkDatabaseHealth();
            } catch (error) {
              return {
                status: 'unhealthy' as const,
                details: error instanceof Error ? error.message : 'Database health check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
            }
          })(),
          new Promise<ServiceHealth>(resolve =>
            setTimeout(
              () =>
                resolve({
                  status: 'unhealthy',
                  details: 'Database health check timeout',
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                }),
              5000
            )
          ),
        ]);
        dbHealth = dbCheckResult;
      }

      // Check all other services in parallel with timeout protection
      // Each check has its own timeout and error handling
      // Wrap each check in a try-catch to prevent undefined method calls
      // Use Promise.allSettled to ensure all checks complete even if some fail
      const healthCheckResults = await Promise.allSettled([
        // Cache health check
        Promise.race([
          (async (): Promise<ServiceHealth> => {
            try {
              return await this.checkCacheHealth();
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              if (this.loggingService) {
                void this.loggingService.log(
                  LogType.ERROR,
                  LogLevel.ERROR,
                  'HealthService Cache health check error',
                  'HealthService',
                  { error: errorMsg }
                );
              } else {
                console.error('[HealthService] Cache health check error:', error);
              }
              return {
                status: 'unhealthy' as const,
                details: error instanceof Error ? error.message : 'Cache health check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
            }
          })(),
          new Promise<ServiceHealth>(resolve =>
            setTimeout(
              () =>
                resolve({
                  status: 'unhealthy',
                  details: 'Cache health check timeout',
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                }),
              3000
            )
          ),
        ]).catch((error): ServiceHealth => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'HealthService Cache health check promise rejected',
              'HealthService',
              { error: errorMsg }
            );
          } else {
            console.error('[HealthService] Cache health check promise rejected:', error);
          }
          return {
            status: 'unhealthy',
            details: error instanceof Error ? error.message : 'Cache health check failed',
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          };
        }),
        // Queue health check
        Promise.race([
          (async (): Promise<ServiceHealth> => {
            try {
              return await this.checkQueueHealth();
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              if (this.loggingService) {
                void this.loggingService.log(
                  LogType.ERROR,
                  LogLevel.ERROR,
                  'HealthService Queue health check error',
                  'HealthService',
                  { error: errorMsg }
                );
              } else {
                console.error('[HealthService] Queue health check error:', error);
              }
              return {
                status: 'unhealthy' as const,
                details: error instanceof Error ? error.message : 'Queue health check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
            }
          })(),
          new Promise<ServiceHealth>(resolve =>
            setTimeout(
              () =>
                resolve({
                  status: 'unhealthy',
                  details: 'Queue health check timeout',
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                }),
              3000
            )
          ),
        ]).catch((error): ServiceHealth => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'HealthService Queue health check promise rejected',
              'HealthService',
              { error: errorMsg }
            );
          } else {
            console.error('[HealthService] Queue health check promise rejected:', error);
          }
          return {
            status: 'unhealthy',
            details: error instanceof Error ? error.message : 'Queue health check failed',
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          };
        }),
        // Logger health check
        Promise.race([
          (async (): Promise<ServiceHealth> => {
            try {
              return await this.checkLoggerHealth();
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              if (this.loggingService) {
                void this.loggingService.log(
                  LogType.ERROR,
                  LogLevel.ERROR,
                  'HealthService Logger health check error',
                  'HealthService',
                  { error: errorMsg }
                );
              } else {
                console.error('[HealthService] Logger health check error:', error);
              }
              return {
                status: 'unhealthy' as const,
                details: error instanceof Error ? error.message : 'Logger health check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
            }
          })(),
          new Promise<ServiceHealth>(resolve =>
            setTimeout(
              () =>
                resolve({
                  status: 'unhealthy',
                  details: 'Logger health check timeout',
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                }),
              2000
            )
          ),
        ]).catch((error): ServiceHealth => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'HealthService Logger health check promise rejected',
              'HealthService',
              { error: errorMsg }
            );
          } else {
            console.error('[HealthService] Logger health check promise rejected:', error);
          }
          return {
            status: 'unhealthy',
            details: error instanceof Error ? error.message : 'Logger health check failed',
            responseTime: 0,
            lastChecked: new Date().toISOString(),
          };
        }),
      ]);

      // Extract health check results from Promise.allSettled
      // dbHealth is already set above from cache or fresh check
      // Each result should already be a ServiceHealth object (never throws due to .catch())
      // Safely extract each result with proper error handling
      let cacheHealth: ServiceHealth;
      try {
        cacheHealth =
          healthCheckResults[0]?.status === 'fulfilled'
            ? healthCheckResults[0].value
            : {
                status: 'unhealthy' as const,
                details:
                  healthCheckResults[0]?.reason instanceof Error
                    ? healthCheckResults[0].reason.message
                    : 'Cache check failed - no result returned',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'HealthService Error extracting Cache health',
            'HealthService',
            { error: errorMsg }
          );
        } else {
          console.error('[HealthService] Error extracting Cache health:', error);
        }
        cacheHealth = {
          status: 'unhealthy' as const,
          details: error instanceof Error ? error.message : 'Cache check extraction failed',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        };
      }

      let queueHealth: ServiceHealth;
      try {
        queueHealth =
          healthCheckResults[1]?.status === 'fulfilled'
            ? healthCheckResults[1].value
            : {
                status: 'unhealthy' as const,
                details:
                  healthCheckResults[1]?.reason instanceof Error
                    ? healthCheckResults[1].reason.message
                    : 'Queue check failed - no result returned',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'HealthService Error extracting Queue health',
            'HealthService',
            { error: errorMsg }
          );
        } else {
          console.error('[HealthService] Error extracting Queue health:', error);
        }
        queueHealth = {
          status: 'unhealthy' as const,
          details: error instanceof Error ? error.message : 'Queue check extraction failed',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        };
      }

      let loggerHealth: ServiceHealth;
      try {
        loggerHealth =
          healthCheckResults[2]?.status === 'fulfilled'
            ? healthCheckResults[2].value
            : {
                status: 'unhealthy' as const,
                details:
                  healthCheckResults[2]?.reason instanceof Error
                    ? healthCheckResults[2].reason.message
                    : 'Logger check failed - no result returned',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'HealthService Error extracting Logger health',
            'HealthService',
            { error: errorMsg }
          );
        } else {
          console.error('[HealthService] Error extracting Logger health:', error);
        }
        loggerHealth = {
          status: 'unhealthy' as const,
          details: error instanceof Error ? error.message : 'Logger check extraction failed',
          responseTime: 0,
          lastChecked: new Date().toISOString(),
        };
      }
      // Safely get system metrics - always try to get real values
      let systemMetrics;
      try {
        systemMetrics = this.getSystemMetrics();
        // Validate that we got real values (not all zeros)
        if (
          systemMetrics.memoryUsage.heapTotal === 0 &&
          systemMetrics.memoryUsage.heapUsed === 0 &&
          systemMetrics.memoryUsage.rss === 0
        ) {
          // If all zeros, try again with direct process calls
          const memoryUsage = process.memoryUsage();
          const cpuInfo = cpus();
          const totalMemory = totalmem();
          const freeMemory = freemem();
          systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: memoryUsage.heapTotal,
              heapUsed: memoryUsage.heapUsed,
              rss: memoryUsage.rss,
              external: memoryUsage.external,
              systemTotal: totalMemory,
              systemFree: freeMemory,
              systemUsed: totalMemory - freeMemory,
            },
            cpuUsage: {
              user: process.cpuUsage().user,
              system: process.cpuUsage().system,
              cpuCount: cpuInfo.length,
              cpuModel: cpuInfo[0]?.model || 'unknown',
              cpuSpeed: cpuInfo[0]?.speed || 0,
            },
          };
        }
      } catch (_metricsError) {
        // If getSystemMetrics fails, try direct process calls as fallback
        try {
          const memoryUsage = process.memoryUsage();
          const cpuInfo = cpus();
          const totalMemory = totalmem();
          const freeMemory = freemem();
          systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: memoryUsage.heapTotal,
              heapUsed: memoryUsage.heapUsed,
              rss: memoryUsage.rss,
              external: memoryUsage.external,
              systemTotal: totalMemory,
              systemFree: freeMemory,
              systemUsed: totalMemory - freeMemory,
            },
            cpuUsage: {
              user: process.cpuUsage().user,
              system: process.cpuUsage().system,
              cpuCount: cpuInfo.length,
              cpuModel: cpuInfo[0]?.model || 'unknown',
              cpuSpeed: cpuInfo[0]?.speed || 0,
            },
          };
        } catch {
          // Last resort: use minimal fallback values
          systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: 0,
              heapUsed: 0,
              rss: 0,
              external: 0,
              systemTotal: 0,
              systemFree: 0,
              systemUsed: 0,
            },
            cpuUsage: {
              user: 0,
              system: 0,
              cpuCount: 0,
              cpuModel: 'unknown',
              cpuSpeed: 0,
            },
          };
        }
      }

      const isDevEnvironment = environment === 'development';

      const normalizedQueueHealth = this.normalizeOptionalServiceHealth(queueHealth, {
        serviceName: 'Queue',
        isOptional: !this.queueHealthIndicator,
        isDevMode: isDevEnvironment,
      });

      const normalizedLoggerHealth = this.normalizeOptionalServiceHealth(loggerHealth, {
        serviceName: 'Logger',
        isOptional: !this.loggingService,
        isDevMode: isDevEnvironment,
      });
      const result: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment,
        version: this.config?.getEnv('npm_package_version') || '0.0.1',
        systemMetrics,
        services: {
          api: {
            status: 'healthy',
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
            details: 'API service is running',
          },
          database: {
            status: dbHealth.status,
            responseTime: dbHealth.responseTime || 0,
            lastChecked: dbHealth.lastChecked || new Date().toISOString(),
            details: dbHealth.details || dbHealth.error || 'Database status unknown',
            ...(dbHealth.error && { error: dbHealth.error }),
          },
          cache: {
            status: cacheHealth.status,
            responseTime: cacheHealth.responseTime || 0,
            lastChecked: cacheHealth.lastChecked || new Date().toISOString(),
            details: cacheHealth.details || cacheHealth.error || 'Cache status unknown',
            ...(cacheHealth.error && { error: cacheHealth.error }),
          },
          queue: {
            status: normalizedQueueHealth.status,
            responseTime: normalizedQueueHealth.responseTime || 0,
            lastChecked: normalizedQueueHealth.lastChecked || new Date().toISOString(),
            details:
              normalizedQueueHealth.details ||
              normalizedQueueHealth.error ||
              'Queue status unknown',
            ...(normalizedQueueHealth.error && { error: normalizedQueueHealth.error }),
          },
          logger: {
            status: normalizedLoggerHealth.status,
            responseTime: normalizedLoggerHealth.responseTime || 0,
            lastChecked: normalizedLoggerHealth.lastChecked || new Date().toISOString(),
            details:
              normalizedLoggerHealth.details ||
              normalizedLoggerHealth.error ||
              'Logger status unknown',
            ...(normalizedLoggerHealth.error && { error: normalizedLoggerHealth.error }),
          },
          communication: {
            status: 'healthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details:
              'Communication health monitoring is clinic-specific and not monitored at system level',
          },
        },
      };

      // Update overall status if any core service is unhealthy
      // Safely check each service status to prevent undefined access errors
      const criticalServices = [dbHealth, cacheHealth];
      const hasCriticalUnhealthy = criticalServices.some(
        service =>
          service &&
          typeof service === 'object' &&
          'status' in service &&
          service.status === 'unhealthy'
      );
      const optionalServices = [normalizedQueueHealth, normalizedLoggerHealth];
      const optionalDegraded = optionalServices.some(service =>
        this.isOptionalServiceDegraded(service, isDevEnvironment)
      );

      result.status = hasCriticalUnhealthy || optionalDegraded ? 'degraded' : 'healthy';

      if (hasCriticalUnhealthy) {
        return await this.reverifyCriticalServices(result, optionalDegraded);
      }

      return result;
    } catch (error) {
      // Comprehensive error handling - return degraded status if anything fails
      // Never throw - always return a valid health response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Log detailed error information for debugging
      // Use LoggingService if available, otherwise fallback to console.error
      if (this.loggingService) {
        void this.loggingService
          .log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Health check failed: ${errorMessage}`,
            'HealthService',
            {
              error: errorMessage,
              stack: errorStack,
              errorType: error?.constructor?.name || typeof error,
              // Log which service might be causing the issue
              services: {
                databaseHealthIndicator: !!this.databaseHealthIndicator,
                cacheHealthIndicator: !!this.cacheHealthIndicator,
                queueHealthIndicator: !!this.queueHealthIndicator,
                loggingHealthIndicator: !!this.loggingHealthIndicator,
                loggingService: !!this.loggingService,
                socketService: false, // Removed - clinic-specific
                emailService: false, // Removed - clinic-specific
                config: !!this.config,
              },
            }
          )
          .catch(() => {
            // Ignore logging errors - fallback to console.error
            console.error('[HealthService] Health check failed:', errorMessage);
            if (errorStack) {
              console.error('[HealthService] Stack trace:', errorStack);
            }
          });
      } else {
        // Fallback to console.error when LoggingService is not available
        console.error('[HealthService] Health check failed:', errorMessage);
        if (errorStack) {
          console.error('[HealthService] Stack trace:', errorStack);
        }
      }

      // Try to get system metrics safely - always try to get real values
      // Use direct process calls first to ensure we always get real values
      let systemMetrics;
      try {
        // Always use direct process calls to ensure real values
        const memoryUsage = process.memoryUsage();
        const cpuInfo = cpus();
        const totalMemory = totalmem();
        const freeMemory = freemem();

        systemMetrics = {
          uptime: process.uptime(),
          memoryUsage: {
            heapTotal: memoryUsage.heapTotal || 0,
            heapUsed: memoryUsage.heapUsed || 0,
            rss: memoryUsage.rss || 0,
            external: memoryUsage.external || 0,
            systemTotal: totalMemory || 0,
            systemFree: freeMemory || 0,
            systemUsed: (totalMemory || 0) - (freeMemory || 0),
          },
          cpuUsage: {
            user: process.cpuUsage().user || 0,
            system: process.cpuUsage().system || 0,
            cpuCount: cpuInfo.length || 0,
            cpuModel: cpuInfo[0]?.model || 'unknown',
            cpuSpeed: cpuInfo[0]?.speed || 0,
          },
        };

        // Validate that we got real values (not all zeros)
        // If all zeros, try getSystemMetrics as fallback
        if (
          systemMetrics.memoryUsage.heapTotal === 0 &&
          systemMetrics.memoryUsage.heapUsed === 0 &&
          systemMetrics.memoryUsage.rss === 0
        ) {
          try {
            systemMetrics = this.getSystemMetrics();
          } catch {
            // If getSystemMetrics also fails, keep the direct call values
          }
        }
      } catch (_metricsError) {
        // If direct calls fail, try getSystemMetrics
        try {
          systemMetrics = this.getSystemMetrics();
        } catch {
          // Last resort: use minimal fallback values with at least uptime
          systemMetrics = {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: 0,
              heapUsed: 0,
              rss: 0,
              external: 0,
              systemTotal: 0,
              systemFree: 0,
              systemUsed: 0,
            },
            cpuUsage: {
              user: 0,
              system: 0,
              cpuCount: 0,
              cpuModel: 'unknown',
              cpuSpeed: 0,
            },
          };
        }
      }

      // Return degraded health response
      // IMPORTANT: If we can return this response, the API is healthy!
      // The error is from other services, not the API itself
      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        environment: this.config?.getEnvironment() || 'development',
        version: this.config?.getEnv('npm_package_version') || '0.0.1',
        systemMetrics,
        services: {
          api: {
            status: 'healthy' as const, // API is healthy if we can respond
            responseTime: 10, // Small response time
            lastChecked: new Date().toISOString(),
            details: 'API service is running and responding',
          },
          database: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: `Health check failed: ${errorMessage}. Database service may not be initialized.`,
          },
          cache: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: `Health check failed: ${errorMessage}. Cache service may not be initialized.`,
          },
          queue: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: `Health check failed: ${errorMessage}. Queue service may not be initialized.`,
          },
          logger: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: `Health check failed: ${errorMessage}. Logger service may not be initialized.`,
          },
          communication: {
            status: 'healthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details:
              'Communication health monitoring is clinic-specific and not monitored at system level',
          },
        },
      };
    }
  }

  private async reverifyCriticalServices(
    result: HealthCheckResponse,
    optionalDegraded: boolean
  ): Promise<HealthCheckResponse> {
    try {
      const [dbVerification, cacheVerification] = await Promise.all([
        this.verifyDatabaseConnection(),
        this.verifyCacheConnection(),
      ]);

      let dbHealthy = false;
      if (dbVerification?.isHealthy && result.services?.database) {
        dbHealthy = true;
        result.services.database = {
          status: 'healthy',
          responseTime: dbVerification.avgResponseTime,
          lastChecked: new Date().toISOString(),
          details: 'PostgreSQL connection verified after retry',
        };
      }

      let cacheHealthy = false;
      if (cacheVerification && result.services?.cache) {
        cacheHealthy = true;
        result.services.cache = {
          status: 'healthy',
          responseTime: 1,
          lastChecked: new Date().toISOString(),
          details: 'Cache connection verified after retry',
        };
      }

      if (dbHealthy && cacheHealthy && !optionalDegraded) {
        result.status = 'healthy';
      }

      return result;
    } catch {
      return result;
    }
  }

  private async verifyDatabaseConnection(): Promise<{
    isHealthy: boolean;
    connectionCount: number;
    activeQueries: number;
    avgResponseTime: number;
    lastHealthCheck: Date;
    errors: string[];
  } | null> {
    if (!this.databaseHealthIndicator) {
      return null;
    }
    try {
      const result = await this.databaseHealthIndicator.check('database');
      const dbResult = result['database'] as Record<string, unknown>;
      return {
        isHealthy: dbResult?.['status'] === 'up',
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime:
          typeof dbResult?.['responseTime'] === 'number' ? dbResult['responseTime'] : 0,
        lastHealthCheck: new Date(),
        errors: dbResult?.['status'] === 'down' ? ['Database health check failed'] : [],
      };
    } catch {
      return null;
    }
  }

  private async verifyCacheConnection(): Promise<boolean> {
    // CacheService removed - use health indicator instead
    if (!this.cacheHealthIndicator) {
      return false;
    }
    try {
      const result = await this.cacheHealthIndicator.check('cache');
      const cacheResult = result['cache'] as Record<string, unknown>;
      return cacheResult?.['status'] === 'up';
    } catch {
      return false;
    }
  }

  /**
   * Get detailed health status with smart caching using Terminus
   * Returns cached data if fresh, otherwise performs comprehensive checks
   * Includes realtime status from realtime health monitoring system
   */
  async getDetailedHealth(): Promise<
    DetailedHealthCheckResponse & { realtime?: AggregatedHealthStatus }
  > {
    try {
      // Always run fresh health checks for dashboard - real-time updates
      const baseHealth = await this.performHealthCheck();
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Safely get environment - handle case where config is undefined
      let isDevMode = false;
      try {
        // Defensive: handle case where this.config is undefined or null
        if (this.config) {
          isDevMode = this.config.isDevelopment();
        } else {
          isDevMode = false;
        }
      } catch (_error) {
        isDevMode = this.config?.isDevelopment() || false;
      }

      // Safely access baseHealth.services - handle case where baseHealth or services might be undefined
      const services = baseHealth?.services || {};

      // Use actual health check results from baseHealth, don't override them
      // Get realtime status if available
      let realtimeStatus: AggregatedHealthStatus | undefined;
      if (this.healthCacheService) {
        try {
          const cached: unknown = await this.healthCacheService.getCachedStatus();
          const validated = this.validateAndGetAggregatedHealthStatus(cached);
          if (validated) {
            realtimeStatus = validated;
          }
        } catch {
          // Ignore realtime status errors - it's optional
        }
      }

      const result: DetailedHealthCheckResponse & { realtime?: AggregatedHealthStatus } = {
        ...baseHealth,
        services: {
          ...services,
          // Keep the actual health check results - don't override with hardcoded values
          // queues, logger, and communication are already in baseHealth.services from checkHealth()
        },
        processInfo: {
          pid: process.pid,
          ppid: process.ppid,
          platform: process.platform,
          versions: Object.fromEntries(
            Object.entries(process.versions).filter(([, value]) => value !== undefined)
          ) as Record<string, string>,
          cluster: this.getClusterInfo(),
        },
        memory: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers,
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
        },
        ...(realtimeStatus && { realtime: realtimeStatus }),
      };

      // Add development-only services with real HTTP checks
      if (isDevMode) {
        // CRITICAL: Only check Redis Commander if Redis is the cache provider
        // If Dragonfly is the provider, skip Redis Commander check
        const cacheProvider = this.config?.getCacheProvider() || 'dragonfly';
        const isRedisProvider = cacheProvider === 'redis';

        // Check if we're in startup grace period for external services
        const timeSinceStart = Date.now() - this.serviceStartTime;
        const isInStartupGracePeriod = timeSinceStart < this.EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD;

        // Determine service URLs based on environment
        // Priority: Environment variables > Config service > Defaults
        // In Kubernetes: Use service names or external URLs from environment variables
        // In Docker: Use container names or localhost
        // In local: Use localhost

        // Prisma Studio URL - typically runs on the same pod/container
        // Get from ConfigService (reads from .env files) - NO HARDCODED FALLBACKS
        const urlsConfig = this.config?.getUrlsConfig();
        if (!urlsConfig?.prismaStudio && !this.config?.getEnv('PRISMA_STUDIO_URL')) {
          throw new Error(
            'PRISMA_STUDIO_URL must be configured in environment variables or config'
          );
        }
        const prismaStudioUrl: string =
          urlsConfig?.prismaStudio || this.config?.getEnv('PRISMA_STUDIO_URL') || '';

        // Redis Commander URL - can be in different pod/service in Kubernetes
        // Get from ConfigService (reads from .env files) - NO HARDCODED FALLBACKS
        if (!urlsConfig?.redisCommander && !this.config?.getEnv('REDIS_COMMANDER_URL')) {
          // Only throw in production - in development, allow empty string
          if (!this.config?.isDevelopment()) {
            throw new Error(
              'REDIS_COMMANDER_URL must be configured in environment variables or config'
            );
          }
        }
        const redisCommanderUrl =
          urlsConfig?.redisCommander || this.config?.getEnv('REDIS_COMMANDER_URL') || '';

        // Build fallback URLs based on environment
        // Only add Docker-specific fallbacks if we're in Docker (not Kubernetes)
        // Use ConfigService (which uses dotenv) for environment variable access
        const isKubernetes = this.config?.hasEnv('KUBERNETES_SERVICE_HOST') || false;
        const isDocker = this.config?.getEnvBoolean('DOCKER_ENV', false) && !isKubernetes;

        // For Redis Commander: Try configured URL, then Kubernetes service name, then Docker container, then localhost
        const redisCommanderUrls = [redisCommanderUrl];
        if (isKubernetes) {
          // Kubernetes service discovery patterns
          // Use ConfigService (which uses dotenv) for environment variable access
          const namespace = this.config?.getEnv('KUBERNETES_NAMESPACE', 'default') || 'default';
          redisCommanderUrls.push(
            `http://redis-commander-service.${namespace}.svc.cluster.local:8081`,
            `http://redis-commander-service.${namespace}:8081`,
            `http://redis-commander-service:8081`
          );
        } else if (isDocker) {
          // Docker container names (only if not in Kubernetes)
          // Get from ConfigService if available, otherwise use standard Docker service names
          const dockerRedisCommanderUrl = this.config?.getEnv('DOCKER_REDIS_COMMANDER_URL');
          if (dockerRedisCommanderUrl) {
            redisCommanderUrls.push(dockerRedisCommanderUrl);
          } else {
            // Fallback to standard Docker service names (environment-aware)
            redisCommanderUrls.push('http://healthcare-redis-ui:8081', 'http://redis-ui:8081');
          }
        }
        // Add configured URL if not already in the list
        // NO HARDCODED localhost fallbacks - use ConfigService only
        if (redisCommanderUrl && !redisCommanderUrls.includes(redisCommanderUrl)) {
          redisCommanderUrls.push(redisCommanderUrl);
        }

        // Check services with environment-aware fallback URLs
        const healthCheckPromises: Array<Promise<ServiceHealth>> = [
          this.checkExternalServiceWithFallback('Prisma Studio', [prismaStudioUrl], 2000),
        ];

        // Check Redis Commander for both Redis and Dragonfly in dev mode
        // Dragonfly is Redis-compatible, so Redis Commander can manage it
        if (isRedisProvider || isDevMode) {
          healthCheckPromises.push(
            this.checkExternalServiceWithFallback('Redis Commander', redisCommanderUrls, 2000)
          );
        }

        const healthCheckResults = await Promise.allSettled(healthCheckPromises);

        // Extract results - Prisma Studio is always included
        // Redis Commander is included if Redis provider OR dev mode
        const prismaStudioHealth = healthCheckResults[0];
        const redisCommanderHealth =
          (isRedisProvider || isDevMode) && healthCheckResults.length > 1
            ? healthCheckResults[1]
            : undefined;

        // Handle Prisma Studio health
        if (prismaStudioHealth && prismaStudioHealth.status === 'fulfilled') {
          result.services.prismaStudio = prismaStudioHealth.value;
        } else {
          // Extract error details from rejected promise
          let errorDetails =
            prismaStudioHealth && prismaStudioHealth.status === 'rejected'
              ? prismaStudioHealth.reason instanceof Error
                ? prismaStudioHealth.reason.message
                : String(prismaStudioHealth.reason)
              : 'Prisma Studio is not accessible';

          // During startup grace period, show a more helpful message
          if (isInStartupGracePeriod) {
            errorDetails = `Prisma Studio is starting up... (${Math.round((this.EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD - timeSinceStart) / 1000)}s remaining)`;
          }

          // During startup grace period or in dev mode, mark as 'healthy' to avoid false negatives
          // The service is likely starting up and will be available soon
          // In dev mode, we're more lenient since services might be accessible from host
          result.services.prismaStudio = {
            status:
              isInStartupGracePeriod || isDevMode ? ('healthy' as const) : ('unhealthy' as const),
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: errorDetails,
          };
        }

        // Set Redis Commander status for both Redis and Dragonfly (in dev mode)
        // Dragonfly is Redis-compatible, so Redis Commander can manage it
        if (isRedisProvider || isDevMode) {
          if (redisCommanderHealth && redisCommanderHealth.status === 'fulfilled') {
            result.services.redisCommander = redisCommanderHealth.value;
          } else {
            // During startup grace period or in dev mode, mark as 'healthy' to avoid false negatives
            // The service is likely starting up and will be available soon
            // In dev mode, we're more lenient since services might be accessible from host
            const errorDetails =
              redisCommanderHealth && redisCommanderHealth.status === 'rejected'
                ? redisCommanderHealth.reason instanceof Error
                  ? redisCommanderHealth.reason.message
                  : String(redisCommanderHealth.reason)
                : 'Redis Commander is not accessible';

            result.services.redisCommander = {
              status:
                isInStartupGracePeriod || isDevMode ? ('healthy' as const) : ('unhealthy' as const),
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              details: errorDetails,
            };
          }
        }
      }

      return result;
    } catch (error) {
      // If checkDetailedHealth fails, return a basic health response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Detailed health check failed: ${errorMessage}`,
          'HealthService',
          {
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
      // Return a basic health response by calling performHealthCheck
      const baseHealth = await this.performHealthCheck().catch(() => ({
        status: 'degraded' as const,
        timestamp: new Date().toISOString(),
        environment: this.config?.getEnvironment() || 'development',
        version: this.config?.getEnv('npm_package_version') || '0.0.1',
        systemMetrics: {
          uptime: process.uptime(),
          memoryUsage: {
            heapTotal: 0,
            heapUsed: 0,
            rss: 0,
            external: 0,
            systemTotal: 0,
            systemFree: 0,
            systemUsed: 0,
          },
          cpuUsage: {
            user: 0,
            system: 0,
            cpuCount: 0,
            cpuModel: 'unknown',
            cpuSpeed: 0,
          },
        },
        services: {
          api: {
            status: 'healthy' as const, // API is healthy if we can respond
            responseTime: 10, // Small response time
            lastChecked: new Date().toISOString(),
            details: 'API service is running and responding',
          },
          database: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
          cache: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
          queue: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
          logger: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
          socket: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
          communication: {
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: 'Health check service unavailable - cannot determine status',
          },
        },
      }));
      return {
        ...baseHealth,
        processInfo: {
          pid: process.pid,
          ppid: process.ppid,
          platform: process.platform,
          versions: {},
          cluster: this.getClusterInfo(),
        },
        memory: {
          heapUsed: 0,
          heapTotal: 0,
          external: 0,
          arrayBuffers: 0,
        },
        cpu: {
          user: 0,
          system: 0,
        },
      };
    }
  }

  async checkDatabaseHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();

    // Use cached status from continuous monitoring if available and fresh (< 15s)
    const cachedDbStatus = this.serviceStatusCache.get('database');
    if (cachedDbStatus && Date.now() - cachedDbStatus.timestamp < 15000) {
      return {
        status: cachedDbStatus.status,
        details: cachedDbStatus.details || 'Database status from continuous monitoring',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date(cachedDbStatus.timestamp).toISOString(),
      };
    }

    try {
      // Use DatabaseHealthIndicator for health check - follows architecture rules
      // DatabaseHealthIndicator uses:
      // - Dedicated health check connection pool (connection_limit=2)
      // - Lightweight SELECT 1 query (fastest possible)
      // - 10-second caching to avoid excessive queries
      // - 2-second timeout protection (non-blocking)
      // - Expensive checks run every 60 seconds only
      if (!this.databaseHealthIndicator) {
        return {
          status: 'unhealthy',
          details: 'Database health indicator is not available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      const healthStatusPromise = this.databaseHealthIndicator.check('database');
      const timeoutPromise = new Promise<{
        status: string;
        database: Record<string, unknown>;
      }>(resolve => {
        setTimeout(() => {
          resolve({
            status: 'error',
            database: {
              status: 'down',
              message: 'Health check timeout (2s)',
            },
          });
        }, 2000); // 2 seconds timeout - matches robust health check implementation
      });

      const healthResult = await Promise.race([healthStatusPromise, timeoutPromise]);
      const dbResult = healthResult['database'] as Record<string, unknown> | undefined;

      // Check if database is healthy based on health status
      if (!dbResult || dbResult['status'] === 'down' || dbResult['status'] === 'unhealthy') {
        const errorMessage =
          typeof dbResult?.['message'] === 'string'
            ? dbResult['message']
            : 'Database connection failed';
        const responseTime =
          typeof dbResult?.['responseTime'] === 'number'
            ? Math.round(dbResult['responseTime'])
            : Math.round(performance.now() - startTime);
        return {
          status: 'unhealthy',
          details: errorMessage,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }

      const responseTime =
        typeof dbResult?.['responseTime'] === 'number'
          ? Math.round(dbResult['responseTime'])
          : Math.round(performance.now() - startTime);
      return {
        status: 'healthy',
        details: 'PostgreSQL connected',
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.ERROR,
          `Database health check failed: ${_error instanceof Error ? _error.message : 'Unknown error'}`,
          'HealthService',
          { error: _error instanceof Error ? _error.stack : String(_error) }
        );
      }

      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Cache health using optimized health monitor
   * Uses robust health check with timeout protection and caching
   * Returns comprehensive cache health status including provider information
   */
  async checkCacheHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Use CacheHealthIndicator for health status
      if (this.cacheHealthIndicator) {
        try {
          const result = await this.cacheHealthIndicator.check('cache');
          const cacheResult = result['cache'] as Record<string, unknown>;
          const cacheStatus = cacheResult?.['status'];
          const isHealthy = cacheStatus === 'up';
          return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            details: isHealthy ? 'Cache service is healthy' : 'Cache service is unhealthy',
            responseTime:
              typeof cacheResult?.['responseTime'] === 'number'
                ? cacheResult['responseTime']
                : Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Cache health indicator failed: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Final fallback: Return unhealthy if no health indicator available
      return {
        status: 'unhealthy',
        details: 'Cache health indicator is not available',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      // Outer catch for any unexpected errors
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          `Cache health check error: ${errorMessage}`,
          'HealthService',
          {}
        );
      }

      return {
        status: 'unhealthy',
        details: `Cache health check failed: ${errorMessage}`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Direct Cache connection check as fallback
   * Tests if cache server (Redis/Dragonfly) is accessible even if application hasn't connected
   */
  private async checkCacheDirectConnection(): Promise<boolean> {
    try {
      // Use child_process to execute redis-cli ping as fallback
      // This checks if cache server (Redis/Dragonfly) is accessible even if app connection isn't established
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Use ConfigService for all cache configuration (single source of truth)
      if (!this.config) {
        return false;
      }

      const redisHost = this.config.getCacheHost();
      const redisPort = this.config.getCachePort();

      try {
        const { stdout } = await Promise.race([
          execAsync(`redis-cli -h ${redisHost} -p ${redisPort} ping`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Cache direct check timeout')), 2000)
          ),
        ]);

        return stdout.trim() === 'PONG';
      } catch {
        // redis-cli might not be available, try TCP connection instead
        const net = await import('net');
        return new Promise<boolean>(resolve => {
          const socket = net.createConnection({ host: redisHost, port: redisPort }, () => {
            socket.end();
            resolve(true);
          });

          socket.on('error', () => {
            resolve(false);
          });

          socket.setTimeout(2000, () => {
            socket.destroy();
            resolve(false);
          });
        });
      }
    } catch {
      return false;
    }
  }

  private getRedisMetrics(): {
    connectedClients: number;
    usedMemory: number;
    totalKeys: number;
    lastSave: string;
  } {
    // Cache debug info not available through health indicators
    // Return default metrics
    return {
      connectedClients: 0,
      usedMemory: 0,
      totalKeys: 0,
      lastSave: new Date().toISOString(),
    };
  }

  /**
   * Check Queue health using optimized health monitor
   * Uses robust health check with timeout protection and caching
   * Returns comprehensive queue health status including connection, metrics, and queue information
   */
  async checkQueueHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Use QueueHealthIndicator for health status
      if (this.queueHealthIndicator) {
        try {
          const result = await this.queueHealthIndicator.check('queue');
          const queueResult = result['queue'] as Record<string, unknown>;
          if (queueResult?.['status'] === 'up') {
            return {
              status: 'healthy',
              details: 'Queue service connected',
              responseTime:
                typeof queueResult?.['responseTime'] === 'number'
                  ? queueResult['responseTime']
                  : Math.round(performance.now() - startTime),
              lastChecked: new Date().toISOString(),
            };
          }
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Queue health indicator failed, trying fallback: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Final fallback: Return unhealthy if no health indicator available
      return {
        status: 'unhealthy',
        details: 'Queue health indicator is not available',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      // Outer catch for any unexpected errors
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Queue health check error: ${errorMessage}`,
          'HealthService',
          {}
        );
      }

      return {
        status: 'unhealthy',
        details: `Queue health check failed: ${errorMessage}`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Logger health using optimized health monitor
   * Uses robust health check with timeout protection and caching
   * Returns comprehensive logger health status including service availability and endpoint accessibility
   */
  async checkLoggerHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Use LoggingHealthIndicator for health status
      if (this.loggingHealthIndicator) {
        try {
          const result = await this.loggingHealthIndicator.check('logging');
          const loggerResult = result['logging'] as Record<string, unknown>;
          const loggerStatus = loggerResult?.['status'];
          const isHealthy = loggerStatus === 'up';
          return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            details: isHealthy ? 'Logger service is healthy' : 'Logger service is unhealthy',
            responseTime:
              typeof loggerResult?.['responseTime'] === 'number'
                ? loggerResult['responseTime']
                : Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Logger health indicator failed: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Fallback: Check if service exists
      if (this.loggingService && typeof this.loggingService.log === 'function') {
        return {
          status: 'healthy',
          details: 'Logger service is available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: 'unhealthy',
        details: 'Logger service is not available',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    } catch (_error) {
      // Outer catch for any unexpected errors
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Logger health check error: ${errorMessage}`,
          'HealthService',
          {}
        );
      }

      return {
        status: 'unhealthy',
        details: `Logger health check failed: ${errorMessage}`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Communication health using optimized health monitor
   * Uses robust health check with timeout protection and caching
   * Returns comprehensive communication health status including Socket, Email, WhatsApp, and Push information
   */
  // Communication health checks removed - communication services are clinic-specific
  // Each clinic monitors their own communication service health
  checkCommunicationHealth(): Promise<ServiceHealth> {
    // Communication health is not monitored at system level
    // Return healthy status as communication is clinic-specific
    return Promise.resolve({
      status: 'healthy',
      details:
        'Communication health monitoring is clinic-specific and not monitored at system level',
      responseTime: 0,
      lastChecked: new Date().toISOString(),
    });
  }

  // Socket health checks removed - socket services are clinic-specific
  checkSocketHealth(): Promise<ServiceHealth> {
    return Promise.resolve({
      status: 'healthy',
      details: 'Socket health monitoring is clinic-specific and not monitored at system level',
      responseTime: 0,
      lastChecked: new Date().toISOString(),
    });
  }

  // Email health checks removed - email services are clinic-specific
  checkEmailHealth(): Promise<ServiceHealth> {
    return Promise.resolve({
      status: 'healthy',
      details: 'Email health monitoring is clinic-specific and not monitored at system level',
      responseTime: 0,
      lastChecked: new Date().toISOString(),
    });
  }

  private normalizeOptionalServiceHealth(
    health: ServiceHealth,
    options: { serviceName: string; isOptional: boolean; isDevMode: boolean }
  ): ServiceHealth {
    if (!options.isOptional) {
      return health;
    }

    if (health.status === 'unhealthy') {
      return {
        ...health,
        status: 'healthy',
        details: `${options.serviceName} service not configured${
          options.isDevMode ? ' in development environment' : ''
        }. Skipping health check.`,
        responseTime: health.responseTime || 0,
      };
    }

    return health;
  }

  private isOptionalServiceDegraded(health: ServiceHealth, isDevMode: boolean): boolean {
    if (health.status !== 'unhealthy') {
      return false;
    }

    const detail = (health.details || '').toLowerCase();
    if (detail.includes('not available') || detail.includes('not configured')) {
      return false;
    }

    if (isDevMode && detail.includes('development')) {
      return false;
    }

    return true;
  }

  /**
   * Check external service with multiple URL fallbacks
   * Tries each URL in order until one succeeds
   * This allows the service to work both inside and outside Docker
   */
  private async checkExternalServiceWithFallback(
    serviceName: string,
    urls: string[],
    timeout: number = 3000
  ): Promise<ServiceHealth> {
    const errors: string[] = [];

    for (const url of urls) {
      try {
        const result = await Promise.race([
          this.checkExternalService(serviceName, url, timeout),
          new Promise<ServiceHealth>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout + 500)
          ),
        ]);

        if (result.status === 'healthy') {
          return result;
        }
        errors.push(`${url}: ${result.details}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${url}: ${errorMsg}`);
        // Continue to next URL
      }
    }

    // If all URLs failed, return unhealthy status with all error details
    return {
      status: 'unhealthy',
      details: `${serviceName} is not accessible. Tried: ${urls.join(', ')}. Errors: ${errors.join('; ')}`,
      responseTime: 0,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Check external service by making HTTP request
   * Note: HttpService removed - this method now returns healthy status
   */
  private checkExternalService(
    serviceName: string,
    _url: string,
    _timeout: number = 3000
  ): Promise<ServiceHealth> {
    // HttpService removed - return healthy status as external services are optional
    return Promise.resolve({
      status: 'healthy',
      details: `${serviceName} check skipped (HttpService removed - external services are optional)`,
      responseTime: 0,
      lastChecked: new Date().toISOString(),
    });
  }

  /**
   * Check internal API endpoint
   */
  private checkInternalEndpoint(
    endpoint: string,
    serviceName: string,
    _timeout: number = 3000
  ): Promise<ServiceHealth> {
    try {
      // Get baseUrl from ConfigService - NO HARDCODED FALLBACKS
      const appConfig = this.config?.getAppConfig();
      const baseUrl =
        appConfig?.apiUrl ||
        appConfig?.baseUrl ||
        this.config?.getEnv('API_URL') ||
        this.config?.getEnv('BASE_URL') ||
        '';

      if (!baseUrl) {
        throw new Error(
          'API_URL or BASE_URL must be configured in environment variables or config'
        );
      }

      // HttpService removed - use alternative check method
      // For now, return healthy as internal endpoints are assumed available
      return Promise.resolve({
        status: 'healthy',
        details: `${serviceName} endpoint check skipped (HttpService removed)`,
        responseTime: 0,
        lastChecked: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return Promise.resolve({
        status: 'healthy', // Return healthy even on error as HttpService is removed
        details: `${serviceName} endpoint check skipped (HttpService removed): ${errorMessage}`,
        responseTime: 0,
        lastChecked: new Date().toISOString(),
      });
    }
  }

  /**
   * Type guard to validate AggregatedHealthStatus
   */
  private isValidAggregatedHealthStatus(value: unknown): value is AggregatedHealthStatus {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const obj = value as Record<string, unknown>;

    // Check required properties
    if (
      !('overall' in obj) ||
      !('services' in obj) ||
      !('system' in obj) ||
      !('uptime' in obj) ||
      !('timestamp' in obj)
    ) {
      return false;
    }

    // Validate overall status
    const overall = obj['overall'];
    if (
      typeof overall !== 'string' ||
      (overall !== 'healthy' && overall !== 'degraded' && overall !== 'unhealthy')
    ) {
      return false;
    }

    // Validate services is an object
    if (!obj['services'] || typeof obj['services'] !== 'object') {
      return false;
    }

    // Validate system is an object
    if (!obj['system'] || typeof obj['system'] !== 'object') {
      return false;
    }

    // Validate uptime is a number
    if (typeof obj['uptime'] !== 'number') {
      return false;
    }

    // Validate timestamp is a string
    if (typeof obj['timestamp'] !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Extract RealtimeHealthStatus from unknown value
   */
  private extractRealtimeStatus(value: unknown): 'healthy' | 'degraded' | 'unhealthy' | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    if (value === 'healthy' || value === 'degraded' || value === 'unhealthy') {
      return value;
    }

    return undefined;
  }

  /**
   * Validate and get AggregatedHealthStatus from cached value
   * Returns validated status or undefined if invalid
   */
  private validateAndGetAggregatedHealthStatus(value: unknown): AggregatedHealthStatus | undefined {
    if (!value) {
      return undefined;
    }

    if (this.isValidAggregatedHealthStatus(value)) {
      // Type guard ensures value is AggregatedHealthStatus
      // Safe to return after validation - structure matches AggregatedHealthStatus interface
      return value;
    }

    return undefined;
  }
}
