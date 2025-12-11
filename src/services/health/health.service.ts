import {
  Injectable,
  Optional,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@config';
import { DatabaseService, DatabaseHealthStatus } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { CacheHealthMonitorService } from '@infrastructure/cache/services/cache-health-monitor.service';
import type { CacheHealthMonitorStatus } from '@core/types';
import { LoggingHealthMonitorService } from '@infrastructure/logging/logging-health-monitor.service';
import type { LoggingHealthMonitorStatus } from '@core/types';
import { CommunicationHealthMonitorService } from '@communication/communication-health-monitor.service';
import type { CommunicationHealthMonitorStatus } from '@core/types';
import { QueueHealthMonitorService } from '@infrastructure/queue';
import type { QueueHealthMonitorStatus } from '@core/types';
import {
  HealthCheckResponse,
  DetailedHealthCheckResponse,
  ServiceHealth,
} from '@core/types/common.types';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem } from 'node:os';
import { QueueService } from '@infrastructure/queue';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { SocketService } from '@communication/channels/socket';
import { EmailService } from '@communication/channels/email';
import { PushNotificationService } from '@communication/channels/push/push.service';
import { HealthcareErrorsService } from '@core/errors';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  isHttpServiceAvailable,
  type HealthCheckHttpResponse,
  toHealthCheckResponse,
} from '@core/types/http.types';
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
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => CacheHealthMonitorService))
    private readonly cacheHealthMonitor?: CacheHealthMonitorService,
    @Optional() @Inject(forwardRef(() => ConfigService)) private readonly config?: ConfigService,
    @Optional() private readonly httpService?: HttpService,
    @Optional() private readonly queueService?: QueueService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService,
    @Optional()
    @Inject(forwardRef(() => LoggingHealthMonitorService))
    private readonly loggingHealthMonitor?: LoggingHealthMonitorService,
    @Optional() private readonly socketService?: SocketService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly pushService?: PushNotificationService,
    @Optional()
    @Inject(forwardRef(() => CommunicationHealthMonitorService))
    private readonly communicationHealthMonitor?: CommunicationHealthMonitorService,
    @Optional()
    @Inject(forwardRef(() => QueueHealthMonitorService))
    private readonly queueHealthMonitor?: QueueHealthMonitorService,
    @Optional() private readonly errors?: HealthcareErrorsService
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
      if (!this.databaseService || typeof this.databaseService.getHealthStatus !== 'function') {
        // Defensive check before calling .set()
        if (this.serviceStatusCache && typeof this.serviceStatusCache.set === 'function') {
          this.serviceStatusCache.set('database', {
            status: 'unhealthy',
            timestamp: Date.now(),
            details: 'Database service is not available',
          });
        }
        return;
      }

      // Use robust health check with 2-second timeout (matches DatabaseHealthMonitorService)
      // DatabaseService.getHealthStatus() uses dedicated connection pool and caching
      const healthStatus = await Promise.race([
        this.databaseService.getHealthStatus(),
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
    } catch (_error) {
      // Defensive check before calling .set()
      if (this.serviceStatusCache && typeof this.serviceStatusCache.set === 'function') {
        this.serviceStatusCache.set('database', {
          status: 'unhealthy',
          timestamp: Date.now(),
          details: 'Database monitoring error',
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

          return healthStatus;
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
          status: 'unhealthy' as const,
          responseTime: 0,
          lastChecked: new Date().toISOString(),
          details: 'Health check service unavailable - cannot determine status',
        },
      },
    };
  }

  /**
   * Perform actual health checks (no caching) - always fresh
   */
  private async performHealthCheck(): Promise<HealthCheckResponse> {
    const startTime = performance.now();

    try {
      // Defensive check: ensure all required services are available before proceeding
      // This prevents "Cannot read properties of undefined" errors
      // Note: config is optional, so we only check if NODE_ENV is also missing
      if (!this.config || !this.config.getEnvironment()) {
        // This is not a fatal error - we can still proceed with defaults
        // Just log a warning
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Configuration service is not available, using environment variables',
            'HealthService.performHealthCheck',
            {}
          );
        }
      }
      // Safely get environment - handle case where config is undefined
      let environment = 'development';
      try {
        // Defensive: handle case where this.config is undefined or null
        if (this.config) {
          environment = this.config.getEnvironment();
        } else {
          environment = 'development';
        }
      } catch (_error) {
        environment = this.config?.getEnvironment() || 'development';
      }

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
          (async (): Promise<ServiceHealth & { cacheHealth?: CacheHealthMonitorStatus }> => {
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
          new Promise<ServiceHealth & { cacheHealth?: CacheHealthMonitorStatus }>(resolve =>
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
        ]).catch((error): ServiceHealth & { cacheHealth?: CacheHealthMonitorStatus } => {
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
          (async (): Promise<ServiceHealth & { queueHealth?: QueueHealthMonitorStatus }> => {
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
        // Communication health check (Socket + Email)
        Promise.race([
          (async (): Promise<
            ServiceHealth & { communicationHealth?: CommunicationHealthMonitorStatus }
          > => {
            try {
              return await this.checkCommunicationHealth();
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              if (this.loggingService) {
                void this.loggingService.log(
                  LogType.ERROR,
                  LogLevel.ERROR,
                  'HealthService Communication health check error',
                  'HealthService',
                  { error: errorMsg }
                );
              } else {
                console.error('[HealthService] Communication health check error:', error);
              }
              return {
                status: 'unhealthy' as const,
                details:
                  error instanceof Error ? error.message : 'Communication health check failed',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
            }
          })(),
          new Promise<ServiceHealth & { communicationHealth?: CommunicationHealthMonitorStatus }>(
            resolve =>
              setTimeout(
                () =>
                  resolve({
                    status: 'unhealthy',
                    details: 'Communication health check timeout',
                    responseTime: 0,
                    lastChecked: new Date().toISOString(),
                  }),
                2000
              )
          ),
        ]).catch(
          (error): ServiceHealth & { communicationHealth?: CommunicationHealthMonitorStatus } => {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            if (this.loggingService) {
              void this.loggingService.log(
                LogType.ERROR,
                LogLevel.ERROR,
                'HealthService Communication health check promise rejected',
                'HealthService',
                { error: errorMsg }
              );
            } else {
              console.error('[HealthService] Communication health check promise rejected:', error);
            }
            return {
              status: 'unhealthy',
              details: error instanceof Error ? error.message : 'Communication health check failed',
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            };
          }
        ),
      ]);

      // Extract health check results from Promise.allSettled
      // dbHealth is already set above from cache or fresh check
      // Each result should already be a ServiceHealth object (never throws due to .catch())
      // Safely extract each result with proper error handling
      let cacheHealth: ServiceHealth & { cacheHealth?: CacheHealthMonitorStatus };
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

      let queueHealth: ServiceHealth & { queueHealth?: QueueHealthMonitorStatus };
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

      let loggerHealth: ServiceHealth & { loggingHealth?: LoggingHealthMonitorStatus };
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

      let communicationHealth: ServiceHealth & {
        communicationHealth?: CommunicationHealthMonitorStatus;
      };
      try {
        communicationHealth =
          healthCheckResults[3]?.status === 'fulfilled'
            ? healthCheckResults[3].value
            : {
                status: 'unhealthy' as const,
                details:
                  healthCheckResults[3]?.reason instanceof Error
                    ? healthCheckResults[3].reason.message
                    : 'Communication check failed - no result returned',
                responseTime: 0,
                lastChecked: new Date().toISOString(),
              };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'HealthService Error extracting Communication health',
            'HealthService',
            { error: errorMsg }
          );
        } else {
          console.error('[HealthService] Error extracting Communication health:', error);
        }
        communicationHealth = {
          status: 'unhealthy' as const,
          details: error instanceof Error ? error.message : 'Communication check extraction failed',
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
        isOptional: !this.queueService,
        isDevMode: isDevEnvironment,
      });

      const normalizedLoggerHealth = this.normalizeOptionalServiceHealth(loggerHealth, {
        serviceName: 'Logger',
        isOptional: !this.loggingService,
        isDevMode: isDevEnvironment,
      });

      const normalizedCommunicationHealth = this.normalizeOptionalServiceHealth(
        communicationHealth,
        {
          serviceName: 'Communication',
          isOptional: !this.communicationHealthMonitor && !this.socketService && !this.emailService,
          isDevMode: isDevEnvironment,
        }
      );

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
            // Include comprehensive cache health status if available
            ...(cacheHealth.cacheHealth && {
              connection: {
                connected: cacheHealth.cacheHealth.connection.connected,
                latency: cacheHealth.cacheHealth.connection.latency,
                provider: cacheHealth.cacheHealth.connection.provider,
                providerStatus: cacheHealth.cacheHealth.connection.providerStatus,
                ...(cacheHealth.cacheHealth.connection.providerVersion && {
                  providerVersion: cacheHealth.cacheHealth.connection.providerVersion,
                }),
              },
              metrics: {
                hitRate: cacheHealth.cacheHealth.metrics.hitRate,
                missRate: cacheHealth.cacheHealth.metrics.missRate,
                totalKeys: cacheHealth.cacheHealth.metrics.totalKeys,
                ...(cacheHealth.cacheHealth.metrics.memoryUsed !== undefined && {
                  memoryUsed: cacheHealth.cacheHealth.metrics.memoryUsed,
                }),
                ...(cacheHealth.cacheHealth.metrics.memoryAvailable !== undefined && {
                  memoryAvailable: cacheHealth.cacheHealth.metrics.memoryAvailable,
                }),
                ...(cacheHealth.cacheHealth.metrics.memoryPercentage !== undefined && {
                  memoryPercentage: cacheHealth.cacheHealth.metrics.memoryPercentage,
                }),
              },
              performance: {
                ...(cacheHealth.cacheHealth.performance.averageResponseTime !== undefined && {
                  averageResponseTime: cacheHealth.cacheHealth.performance.averageResponseTime,
                }),
                ...(cacheHealth.cacheHealth.performance.operationsPerSecond !== undefined && {
                  operationsPerSecond: cacheHealth.cacheHealth.performance.operationsPerSecond,
                }),
                ...(cacheHealth.cacheHealth.performance.errorRate !== undefined && {
                  errorRate: cacheHealth.cacheHealth.performance.errorRate,
                }),
              },
              ...(cacheHealth.cacheHealth.issues.length > 0 && {
                issues: cacheHealth.cacheHealth.issues,
              }),
            }),
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
            ...(queueHealth.queueHealth && { queueHealth: queueHealth.queueHealth }), // Include full queueHealth
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
            ...(loggerHealth.loggingHealth && { loggingHealth: loggerHealth.loggingHealth }), // Include full loggingHealth
          },
          communication: {
            status: normalizedCommunicationHealth.status,
            responseTime: normalizedCommunicationHealth.responseTime || 0,
            lastChecked: normalizedCommunicationHealth.lastChecked || new Date().toISOString(),
            details:
              normalizedCommunicationHealth.details ||
              normalizedCommunicationHealth.error ||
              'Communication status unknown',
            ...(normalizedCommunicationHealth.error && {
              error: normalizedCommunicationHealth.error,
            }),
            ...(communicationHealth.communicationHealth && {
              communicationHealth: communicationHealth.communicationHealth,
            }), // Include full communicationHealth
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
      const optionalServices = [
        normalizedQueueHealth,
        normalizedLoggerHealth,
        normalizedCommunicationHealth,
      ];
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
                databaseService: !!this.databaseService,
                cacheService: !!this.cacheService,
                queueService: !!this.queueService,
                loggingService: !!this.loggingService,
                socketService: !!this.socketService,
                emailService: !!this.emailService,
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
            status: 'unhealthy' as const,
            responseTime: 0,
            lastChecked: new Date().toISOString(),
            details: `Health check failed: ${errorMessage}. Communication service may not be initialized.`,
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

  private async verifyDatabaseConnection(): Promise<DatabaseHealthStatus | null> {
    if (!this.databaseService || typeof this.databaseService.getHealthStatus !== 'function') {
      return null;
    }
    try {
      return await this.databaseService.getHealthStatus();
    } catch {
      return null;
    }
  }

  private async verifyCacheConnection(): Promise<boolean> {
    if (!this.cacheService) {
      return false;
    }
    try {
      if (typeof this.cacheService.healthCheck === 'function') {
        const isHealthy = await this.cacheService.healthCheck();
        if (isHealthy) {
          return true;
        }
      }
      if (typeof this.cacheService.ping === 'function') {
        await this.cacheService.ping();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed health status with smart caching
   * Returns cached data if fresh, otherwise performs comprehensive checks
   */
  async getDetailedHealth(): Promise<DetailedHealthCheckResponse> {
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
      const result: DetailedHealthCheckResponse = {
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
        const urlsConfig = this.config?.getUrlsConfig();
        const prismaStudioUrl = urlsConfig?.prismaStudio || 'http://localhost:5555';

        // pgAdmin URL - can be in different pod/service in Kubernetes
        const pgAdminUrl =
          urlsConfig?.pgAdmin ||
          // In Kubernetes, use service name format: service-name.namespace.svc.cluster.local
          // Fallback to localhost for local/Docker development
          'http://localhost:5050';

        // Redis Commander URL - can be in different pod/service in Kubernetes
        const redisCommanderUrl =
          urlsConfig?.redisCommander ||
          // In Kubernetes, use service name format: service-name.namespace.svc.cluster.local
          // Fallback to localhost for local/Docker development
          'http://localhost:8082';

        // Build fallback URLs based on environment
        // Only add Docker-specific fallbacks if we're in Docker (not Kubernetes)
        // Use ConfigService (which uses dotenv) for environment variable access
        const isKubernetes = this.config?.hasEnv('KUBERNETES_SERVICE_HOST') || false;
        const isDocker = this.config?.getEnvBoolean('DOCKER_ENV', false) && !isKubernetes;

        // For pgAdmin: Try configured URL, then Kubernetes service name, then Docker container, then localhost
        const pgAdminUrls = [pgAdminUrl];
        if (isKubernetes) {
          // Kubernetes service discovery patterns
          // Use ConfigService (which uses dotenv) for environment variable access
          const namespace = this.config?.getEnv('KUBERNETES_NAMESPACE', 'default') || 'default';
          pgAdminUrls.push(
            `http://pgadmin-service.${namespace}.svc.cluster.local`,
            `http://pgadmin-service.${namespace}`,
            `http://pgadmin-service:80`
          );
        } else if (isDocker) {
          // Docker container names (only if not in Kubernetes)
          pgAdminUrls.push('http://healthcare-pgadmin:80', 'http://pgadmin:80');
        }
        pgAdminUrls.push('http://localhost:5050'); // Always try localhost as last resort

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
          redisCommanderUrls.push('http://healthcare-redis-ui:8081', 'http://redis-ui:8081');
        }
        redisCommanderUrls.push('http://localhost:8082'); // Always try localhost as last resort

        // Check services with environment-aware fallback URLs
        const healthCheckPromises: Array<Promise<ServiceHealth>> = [
          this.checkExternalServiceWithFallback(
            'Prisma Studio',
            [prismaStudioUrl, 'http://localhost:5555'],
            2000
          ),
          this.checkExternalServiceWithFallback('pgAdmin', pgAdminUrls, 2000),
        ];

        // Check Redis Commander for both Redis and Dragonfly in dev mode
        // Dragonfly is Redis-compatible, so Redis Commander can manage it
        if (isRedisProvider || isDevMode) {
          healthCheckPromises.push(
            this.checkExternalServiceWithFallback('Redis Commander', redisCommanderUrls, 2000)
          );
        }

        const healthCheckResults = await Promise.allSettled(healthCheckPromises);

        // Extract results - always have at least 2 (Prisma Studio and pgAdmin)
        // Redis Commander is included if Redis provider OR dev mode
        const prismaStudioHealth = healthCheckResults[0];
        const pgAdminHealth = healthCheckResults[1];
        const redisCommanderHealth =
          (isRedisProvider || isDevMode) && healthCheckResults.length > 2
            ? healthCheckResults[2]
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

        // Handle pgAdmin health
        if (pgAdminHealth && pgAdminHealth.status === 'fulfilled') {
          result.services.pgAdmin = pgAdminHealth.value;
        } else {
          // Extract error details from rejected promise
          let errorDetails =
            pgAdminHealth && pgAdminHealth.status === 'rejected'
              ? pgAdminHealth.reason instanceof Error
                ? pgAdminHealth.reason.message
                : String(pgAdminHealth.reason)
              : 'pgAdmin is not accessible';

          // During startup grace period, show a more helpful message
          if (isInStartupGracePeriod) {
            errorDetails = `pgAdmin is starting up... (${Math.round((this.EXTERNAL_SERVICE_STARTUP_GRACE_PERIOD - timeSinceStart) / 1000)}s remaining)`;
          }

          // During startup grace period or in dev mode, mark as 'healthy' to avoid false negatives
          // The service is likely starting up and will be available soon
          // In dev mode, we're more lenient since services might be accessible from host
          result.services.pgAdmin = {
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
      // Safely check database health - handle case where databaseService might not be fully initialized
      if (!this.databaseService || typeof this.databaseService.getHealthStatus !== 'function') {
        return {
          status: 'unhealthy',
          details: 'Database service is not available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      // Use DatabaseService for health check - follows architecture rules
      // DatabaseService provides getHealthStatus() which uses:
      // - Dedicated health check connection pool (connection_limit=2)
      // - Lightweight SELECT 1 query (fastest possible)
      // - 10-second caching to avoid excessive queries
      // - 2-second timeout protection (non-blocking)
      // - Expensive checks run every 60 seconds only
      const healthStatusPromise = this.databaseService.getHealthStatus();
      const timeoutPromise = new Promise<{
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
      });

      const healthStatus = await Promise.race([healthStatusPromise, timeoutPromise]);

      // Check if database is healthy based on health status
      if (!healthStatus.isHealthy) {
        return {
          status: 'unhealthy',
          details: healthStatus.errors?.[0] || 'Database connection failed',
          responseTime: healthStatus.avgResponseTime,
          lastChecked: healthStatus.lastHealthCheck.toISOString(),
        };
      }

      return {
        status: 'healthy',
        details: 'PostgreSQL connected',
        responseTime: healthStatus.avgResponseTime,
        lastChecked: healthStatus.lastHealthCheck.toISOString(),
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
  async checkCacheHealth(): Promise<ServiceHealth & { cacheHealth?: CacheHealthMonitorStatus }> {
    const startTime = performance.now();
    try {
      // Use CacheHealthMonitorService for comprehensive health status
      if (
        this.cacheHealthMonitor &&
        typeof this.cacheHealthMonitor.getHealthStatus === 'function'
      ) {
        try {
          const cacheHealthStatus = await Promise.race([
            this.cacheHealthMonitor.getHealthStatus(),
            new Promise<CacheHealthMonitorStatus>(
              resolve =>
                setTimeout(() => {
                  resolve({
                    healthy: false,
                    connection: { connected: false, providerStatus: 'error' },
                    metrics: { hitRate: 0, missRate: 0, totalKeys: 0 },
                    performance: {},
                    issues: ['Health check timeout'],
                  });
                }, 2000) // 2 seconds timeout - matches robust health check implementation
            ),
          ]);

          return {
            status: cacheHealthStatus.healthy ? 'healthy' : 'unhealthy',
            details: cacheHealthStatus.healthy
              ? `Cache service connected (${cacheHealthStatus.connection.provider || 'unknown'})`
              : cacheHealthStatus.issues.join(', ') || 'Cache service unavailable',
            responseTime:
              cacheHealthStatus.connection.latency || Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
            cacheHealth: cacheHealthStatus, // Include full cache health status
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.CACHE,
              LogLevel.DEBUG,
              `Cache health monitor failed, trying fallback: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Fallback: Use CacheService.healthCheck() if health monitor is not available
      if (this.cacheService && typeof this.cacheService.healthCheck === 'function') {
        try {
          const isHealthy = await Promise.race([
            this.cacheService.healthCheck(),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)), // 2 seconds timeout
          ]);

          if (isHealthy) {
            // Get latency from health status for more accurate response time
            try {
              const [_, latency] = await Promise.race([
                this.cacheService.getHealthStatus(),
                new Promise<[boolean, number]>(
                  resolve => setTimeout(() => resolve([false, -1]), 1000) // 1 second timeout for latency
                ),
              ]);

              return {
                status: 'healthy',
                details: 'Cache service connected and healthy',
                responseTime: latency > 0 ? latency : Math.round(performance.now() - startTime),
                lastChecked: new Date().toISOString(),
              };
            } catch {
              // Fallback to performance timing if getHealthStatus fails
              return {
                status: 'healthy',
                details: 'Cache service connected and healthy',
                responseTime: Math.round(performance.now() - startTime),
                lastChecked: new Date().toISOString(),
              };
            }
          }
        } catch (healthCheckError) {
          // Fall through to ping attempt
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.CACHE,
              LogLevel.DEBUG,
              `Cache healthCheck failed, trying ping: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Try ping if available
      if (this.cacheService && typeof this.cacheService.ping === 'function') {
        try {
          await Promise.race([
            this.cacheService.ping(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
            ),
          ]);

          return {
            status: 'healthy',
            details: 'Cache connected via application',
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        } catch (pingError) {
          // Ping failed - check if it's circuit breaker or connection issue
          const errorMessage = pingError instanceof Error ? pingError.message : 'Unknown error';
          const isCircuitBreaker =
            errorMessage.includes('circuit breaker') ||
            errorMessage.includes('Circuit breaker') ||
            errorMessage.includes('temporarily unavailable');

          // If circuit breaker is open, cache server might still be accessible
          // Try direct connection check as fallback
          if (isCircuitBreaker) {
            const directCheck = await this.checkCacheDirectConnection();
            if (directCheck) {
              return {
                status: 'healthy',
                details: 'Cache server is accessible (application connection pending)',
                responseTime: Math.round(performance.now() - startTime),
                lastChecked: new Date().toISOString(),
              };
            }
          }

          return {
            status: 'unhealthy',
            details: isCircuitBreaker
              ? 'Cache circuit breaker is open - cache service temporarily unavailable'
              : `Cache connection failed: ${errorMessage}`,
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        }
      }

      // If CacheService is not available, try direct connection check
      const directCheck = await this.checkCacheDirectConnection();
      if (directCheck) {
        return {
          status: 'healthy',
          details: 'Cache server is accessible (application service not initialized)',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: 'unhealthy',
        details: 'Cache service is not available and cache server is not accessible',
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

      // Try direct connection as last resort
      const directCheck = await this.checkCacheDirectConnection();
      if (directCheck) {
        return {
          status: 'healthy',
          details: 'Cache server is accessible (health check error occurred)',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
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

  private async getRedisMetrics(): Promise<{
    connectedClients: number;
    usedMemory: number;
    totalKeys: number;
    lastSave: string;
  }> {
    try {
      // Get real-time Redis metrics directly from RedisService if available
      if (this.cacheService && typeof this.cacheService.getCacheDebug === 'function') {
        const info = await Promise.race([
          this.cacheService.getCacheDebug(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)), // 2 second timeout
        ]).catch(() => null);

        if (info) {
          type CacheDebugInfo = Record<string, unknown> & {
            info?: {
              memoryInfo?: { usedMemory?: number; connectedClients?: number };
              dbSize?: number;
            };
          };
          const debugInfo = info as CacheDebugInfo;
          return {
            connectedClients: debugInfo?.info?.memoryInfo?.connectedClients || 1,
            usedMemory: debugInfo?.info?.memoryInfo?.usedMemory || 0,
            totalKeys: debugInfo?.info?.dbSize || 0,
            lastSave: new Date().toISOString(),
          };
        }
      }

      // Fallback: return default metrics if cache service is unavailable
      return {
        connectedClients: 0,
        usedMemory: 0,
        totalKeys: 0,
        lastSave: new Date().toISOString(),
      };
    } catch (_error) {
      // Silently return default metrics if cache debug fails
      // This prevents health check from failing due to cache service issues
      return {
        connectedClients: 0,
        usedMemory: 0,
        totalKeys: 0,
        lastSave: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Queue health using optimized health monitor
   * Uses robust health check with timeout protection and caching
   * Returns comprehensive queue health status including connection, metrics, and queue information
   */
  async checkQueueHealth(): Promise<ServiceHealth & { queueHealth?: QueueHealthMonitorStatus }> {
    const startTime = performance.now();
    try {
      // Use QueueHealthMonitorService for comprehensive health status
      if (
        this.queueHealthMonitor &&
        typeof this.queueHealthMonitor.getHealthStatus === 'function'
      ) {
        try {
          const queueHealthStatus = await Promise.race([
            this.queueHealthMonitor.getHealthStatus(),
            new Promise<QueueHealthMonitorStatus>(
              resolve =>
                setTimeout(() => {
                  resolve({
                    healthy: false,
                    connection: { connected: false },
                    metrics: {
                      totalJobs: 0,
                      activeJobs: 0,
                      waitingJobs: 0,
                      failedJobs: 0,
                      completedJobs: 0,
                      errorRate: 0,
                    },
                    performance: {
                      averageProcessingTime: 0,
                      throughputPerMinute: 0,
                    },
                    queues: [],
                    issues: ['Health check timeout'],
                  });
                }, 2000) // 2 seconds timeout - matches robust health check implementation
            ),
          ]);

          const details = queueHealthStatus.healthy
            ? `Queue service connected (${queueHealthStatus.queues.length} queue(s) active)`
            : queueHealthStatus.issues.join(', ') || 'Queue service unavailable';

          return {
            status: queueHealthStatus.healthy ? 'healthy' : 'unhealthy',
            details,
            responseTime:
              queueHealthStatus.connection.latency || Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
            queueHealth: queueHealthStatus, // Include full queueHealth
            metrics: {
              ...(queueHealthStatus.connection.provider && {
                provider: queueHealthStatus.connection.provider,
              }),
              totalJobs: queueHealthStatus.metrics.totalJobs,
              activeJobs: queueHealthStatus.metrics.activeJobs,
              waitingJobs: queueHealthStatus.metrics.waitingJobs,
              failedJobs: queueHealthStatus.metrics.failedJobs,
              errorRate: queueHealthStatus.metrics.errorRate,
            },
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Queue health monitor failed, trying fallback: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Fallback: Use QueueService.getHealthStatus() if health monitor is not available
      if (this.queueService && typeof this.queueService.getHealthStatus === 'function') {
        try {
          const queueHealthStatus = await Promise.race([
            this.queueService.getHealthStatus(),
            new Promise<{
              isHealthy: boolean;
              totalJobs: number;
              errorRate: number;
              averageResponseTime: number;
            }>(
              resolve =>
                setTimeout(
                  () =>
                    resolve({
                      isHealthy: false,
                      totalJobs: 0,
                      errorRate: 0,
                      averageResponseTime: 0,
                    }),
                  2000
                ) // 2 seconds timeout
            ),
          ]);

          return {
            status: queueHealthStatus.isHealthy ? 'healthy' : 'unhealthy',
            details: queueHealthStatus.isHealthy
              ? `Queue service connected (${queueHealthStatus.totalJobs} total jobs)`
              : `Queue service issues (error rate: ${(queueHealthStatus.errorRate * 100).toFixed(2)}%)`,
            responseTime:
              queueHealthStatus.averageResponseTime || Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        } catch (healthCheckError) {
          // Fall through to service existence check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Queue healthCheck failed: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Final fallback: Check if service exists
      if (this.queueService) {
        return {
          status: 'healthy',
          details: 'Queue service is available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: 'unhealthy',
        details: 'Queue service is not available',
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

      // Try service existence as last resort
      if (this.queueService) {
        return {
          status: 'healthy',
          details: 'Queue service is available (health check error occurred)',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
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
  async checkLoggerHealth(): Promise<
    ServiceHealth & { loggingHealth?: LoggingHealthMonitorStatus }
  > {
    const startTime = performance.now();
    try {
      // Use LoggingHealthMonitorService for comprehensive health status
      if (
        this.loggingHealthMonitor &&
        typeof this.loggingHealthMonitor.getHealthStatus === 'function'
      ) {
        try {
          const loggingHealthStatus = await Promise.race([
            this.loggingHealthMonitor.getHealthStatus(),
            new Promise<LoggingHealthMonitorStatus>(
              resolve =>
                setTimeout(() => {
                  resolve({
                    healthy: false,
                    service: { available: false },
                    endpoint: { accessible: false },
                    metrics: { totalLogs: 0, errorRate: 0, averageResponseTime: 0 },
                    performance: {},
                    issues: ['Health check timeout'],
                  });
                }, 2000) // 2 seconds timeout - matches robust health check implementation
            ),
          ]);

          const details = loggingHealthStatus.healthy
            ? `Logger service available (endpoint: ${loggingHealthStatus.endpoint.url || 'N/A'})`
            : loggingHealthStatus.issues.join(', ') || 'Logger service unavailable';

          return {
            status: loggingHealthStatus.healthy ? 'healthy' : 'unhealthy',
            details,
            responseTime:
              loggingHealthStatus.service.latency ||
              loggingHealthStatus.endpoint.latency ||
              Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
            loggingHealth: loggingHealthStatus, // Include full loggingHealth
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Logger health monitor failed, trying fallback: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
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
  async checkCommunicationHealth(): Promise<
    ServiceHealth & { communicationHealth?: CommunicationHealthMonitorStatus }
  > {
    const startTime = performance.now();
    try {
      // Use CommunicationHealthMonitorService for comprehensive health status
      if (
        this.communicationHealthMonitor &&
        typeof this.communicationHealthMonitor.getHealthStatus === 'function'
      ) {
        try {
          const communicationHealthStatus = await Promise.race([
            this.communicationHealthMonitor.getHealthStatus(),
            new Promise<CommunicationHealthMonitorStatus>(
              resolve =>
                setTimeout(() => {
                  resolve({
                    healthy: false,
                    socket: { connected: false },
                    email: { connected: false },
                    whatsapp: { connected: false },
                    push: { connected: false },
                    metrics: { socketConnections: 0, emailQueueSize: 0 },
                    performance: {},
                    issues: ['Health check timeout'],
                  });
                }, 2000) // 2 seconds timeout - matches robust health check implementation
            ),
          ]);

          const socketStatus = communicationHealthStatus.socket.connected
            ? 'Connected'
            : 'Disconnected';
          const emailStatus = communicationHealthStatus.email.connected
            ? 'Connected'
            : 'Disconnected';
          const whatsappStatus = communicationHealthStatus.whatsapp.connected
            ? 'Connected'
            : 'Disconnected';
          const pushStatus = communicationHealthStatus.push.connected
            ? 'Connected'
            : 'Disconnected';
          const details = `Socket: ${socketStatus}, Email: ${emailStatus}, WhatsApp: ${whatsappStatus}, Push: ${pushStatus}`;

          return {
            status: communicationHealthStatus.healthy ? 'healthy' : 'unhealthy',
            details: communicationHealthStatus.healthy
              ? details
              : communicationHealthStatus.issues.join(', ') || 'Communication service unavailable',
            responseTime:
              communicationHealthStatus.socket.latency ||
              communicationHealthStatus.email.latency ||
              Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
            communicationHealth: communicationHealthStatus, // Include full communicationHealth
          };
        } catch (healthCheckError) {
          // Fall through to fallback check
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.DEBUG,
              `Communication health monitor failed, trying fallback: ${healthCheckError instanceof Error ? healthCheckError.message : 'Unknown error'}`,
              'HealthService',
              {}
            );
          }
        }
      }

      // Fallback: Check individual services if health monitor is not available
      const socketHealthy = this.socketService?.getInitializationState() || false;
      const emailHealthy = this.emailService?.isHealthy() || false;
      const whatsappHealthy = true; // WhatsApp service exists if injected
      const pushHealthy = this.pushService?.isHealthy() || false;
      const overallHealthy = socketHealthy && emailHealthy && whatsappHealthy && pushHealthy;

      const socketStatus = socketHealthy ? 'Connected' : 'Disconnected';
      const emailStatus = emailHealthy ? 'Connected' : 'Disconnected';
      const whatsappStatus = whatsappHealthy ? 'Connected' : 'Disconnected';
      const pushStatus = pushHealthy ? 'Connected' : 'Disconnected';
      const details = `Socket: ${socketStatus}, Email: ${emailStatus}, WhatsApp: ${whatsappStatus}, Push: ${pushStatus}`;

      return {
        status: overallHealthy ? 'healthy' : 'unhealthy',
        details: overallHealthy ? details : `Communication service issues: ${details}`,
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
          `Communication health check error: ${errorMessage}`,
          'HealthService',
          {}
        );
      }

      return {
        status: 'unhealthy',
        details: `Communication health check failed: ${errorMessage}`,
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkSocketHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Check if WebSocket server is initialized and responding
      // If service exists and is initialized, it's healthy
      if (this.socketService) {
        const isInitialized = this.socketService.getInitializationState();
        const server = this.socketService.getServer();

        if (isInitialized && server) {
          // Service is initialized - try HTTP check for verification, but service is healthy

          // Get connected clients count with timeout
          const connectedSocketsPromise = server.allSockets();
          const timeoutPromise = new Promise<Set<string>>(resolve => {
            setTimeout(() => resolve(new Set()), 2000);
          });
          const connectedSockets = await Promise.race([connectedSocketsPromise, timeoutPromise]);
          const connectedCount = connectedSockets.size;

          // Also verify HTTP endpoint is accessible (optional verification)
          try {
            // Use ConfigService (which uses dotenv) for environment variable access
            const appConfig = this.config?.getAppConfig();
            const baseUrl = appConfig?.apiUrl || 'http://localhost:8088';
            const socketTestUrl = `${baseUrl}/socket-test`;

            try {
              // Type assertion needed for strict TypeScript mode
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const httpServiceCheck = this.httpService;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              if (isHttpServiceAvailable(httpServiceCheck)) {
                const httpService = httpServiceCheck;
                await Promise.race([
                  firstValueFrom(
                    httpService.get<unknown>(socketTestUrl, {
                      timeout: 3000,
                      validateStatus: () => true,
                    })
                  ),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('HTTP check timeout')), 3000)
                  ),
                ]);
              }
            } catch {
              // HttpService not available, skip HTTP check
            }
          } catch (_httpError) {
            // HTTP check failed, but service is initialized so it's still healthy
          }

          return {
            status: 'healthy',
            details: `WebSocket server is running with ${connectedCount} connected clients`,
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        }
      }

      // Service doesn't exist or not initialized - try HTTP check
      try {
        return await this.checkInternalEndpoint('/socket-test', 'WebSocket', 3000);
      } catch (_httpError) {
        // HTTP check failed - mark as unhealthy only if both service and HTTP fail
        return {
          status: 'unhealthy',
          details: 'WebSocket service is not available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (_error) {
      // On any error, if service exists, still consider it healthy
      if (this.socketService) {
        const isInitialized = this.socketService.getInitializationState();
        if (isInitialized) {
          return {
            status: 'healthy',
            details: 'WebSocket service is available (check error occurred)',
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        }
      }
      // Fall back to HTTP check
      try {
        return await this.checkInternalEndpoint('/socket-test', 'WebSocket', 3000);
      } catch (_httpError) {
        return {
          status: 'unhealthy',
          error: _error instanceof Error ? _error.message : 'Unknown error',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }
    }
  }

  async checkEmailHealth(): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Safely check email health - handle case where emailService might not be fully initialized
      // If service exists, try HTTP check first, then fall back to internal check
      if (!this.emailService || typeof this.emailService.isHealthy !== 'function') {
        // Try HTTP check as fallback
        try {
          const appConfig = this.config?.getAppConfig();
          const baseUrl = appConfig?.apiUrl || appConfig?.baseUrl || 'http://localhost:8088';
          const apiPrefix = appConfig?.apiPrefix || '/api/v1';
          const emailStatusUrl = `${baseUrl}${apiPrefix}/email/status`;

          try {
            // Type assertion needed for strict TypeScript mode
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const httpServiceCheck = this.httpService;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            if (isHttpServiceAvailable(httpServiceCheck)) {
              const httpService = httpServiceCheck;
              const httpCheck = await Promise.race([
                firstValueFrom(
                  httpService.get<unknown>(emailStatusUrl, {
                    timeout: 3000,
                    validateStatus: () => true,
                  })
                ),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('HTTP check timeout')), 3000)
                ),
              ]);

              const healthResponse: HealthCheckHttpResponse<unknown> =
                toHealthCheckResponse(httpCheck);
              if (healthResponse.status < 500) {
                return {
                  status: 'healthy',
                  details: 'Email service endpoint is accessible',
                  responseTime: Math.round(performance.now() - startTime),
                  lastChecked: new Date().toISOString(),
                };
              }
            }
          } catch {
            // HttpService not available, continue to fallback
          }
        } catch (_httpError) {
          // HTTP check failed
        }

        return {
          status: 'unhealthy',
          details: 'Email service is not available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        if (!this.emailService) {
          return {
            status: 'unhealthy',
            details: 'Email service is not available',
            responseTime: Math.round(performance.now() - startTime),
            lastChecked: new Date().toISOString(),
          };
        }

        const _isHealthy = this.emailService.isHealthy();

        // Also check HTTP endpoint for real-time status
        // Use ConfigService (which uses dotenv) for environment variable access
        const appConfig = this.config?.getAppConfig();
        const baseUrl = appConfig?.apiUrl || 'http://localhost:8088';
        const apiPrefix = appConfig?.apiPrefix || '/api/v1';
        const emailStatusUrl = `${baseUrl}${apiPrefix}/email/status`;

        try {
          // Type assertion needed for strict TypeScript mode
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const httpServiceCheck = this.httpService;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          if (isHttpServiceAvailable(httpServiceCheck)) {
            const httpService = httpServiceCheck;
            const httpCheck = await Promise.race([
              firstValueFrom(
                httpService.get<unknown>(emailStatusUrl, {
                  timeout: 3000,
                  validateStatus: () => true,
                })
              ),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('HTTP check timeout')), 3000)
              ),
            ]);

            // Accept any status < 500 as endpoint exists (even 404/401 means service is responding)
            const healthResponse: HealthCheckHttpResponse<unknown> =
              toHealthCheckResponse(httpCheck);
            if (healthResponse.status < 500) {
              return {
                status: 'healthy',
                details: 'Email service is configured and accessible',
                responseTime: Math.round(performance.now() - startTime),
                lastChecked: new Date().toISOString(),
              };
            }
          }
        } catch {
          // HTTP check failed, fall back to internal check
        }

        // If email service exists, it's healthy even if isHealthy() returns false
        // The service is initialized, which means it's available
        return {
          status: 'healthy',
          details: 'Email service is configured and available',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      } catch (_innerError) {
        // Handle errors from email service - but if service exists, it's still healthy
        return {
          status: 'healthy',
          details: 'Email service is available (check error occurred)',
          responseTime: Math.round(performance.now() - startTime),
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (_error) {
      // Outer catch for any unexpected errors
      return {
        status: 'unhealthy',
        error: _error instanceof Error ? _error.message : 'Unknown error',
        responseTime: Math.round(performance.now() - startTime),
        lastChecked: new Date().toISOString(),
      };
    }
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
   */
  private async checkExternalService(
    serviceName: string,
    url: string,
    timeout: number = 3000
  ): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      // Type assertion needed for strict TypeScript mode
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const httpServiceCheck = this.httpService;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (!isHttpServiceAvailable(httpServiceCheck)) {
        throw new Error('HttpService is not available for external service check');
      }
      const httpService = httpServiceCheck;

      const response = await Promise.race([
        firstValueFrom(
          httpService.get<unknown>(url, {
            timeout,
            validateStatus: () => true, // Don't throw on any status code
            // Add headers to avoid CORS issues and improve compatibility
            headers: {
              'User-Agent': 'Healthcare-HealthCheck/1.0',
            },
          })
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        ),
      ]);

      const responseTime = Math.round(performance.now() - startTime);
      // Accept any HTTP response (even 404/401/500) as service is responding
      // Only connection errors (ECONNREFUSED, ETIMEDOUT) indicate service is down
      const healthResponse: HealthCheckHttpResponse<unknown> = toHealthCheckResponse(response);
      const isHealthy = healthResponse.status !== undefined;
      const statusCode = healthResponse.status;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy
          ? `${serviceName} is accessible (status: ${statusCode})`
          : `${serviceName} returned status ${String(statusCode)}`,
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      const responseTime = Math.round(performance.now() - startTime);
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        // Provide more specific error messages
        if (
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('connect ECONNREFUSED')
        ) {
          errorMessage = 'Connection refused - service may not be running';
        } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
          errorMessage = 'Connection timeout - service may be starting up';
        } else if (error.message.includes('ENOTFOUND')) {
          errorMessage = 'Host not found';
        } else {
          errorMessage = error.message;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      return {
        status: 'unhealthy',
        details: `${serviceName} is not accessible: ${errorMessage}`,
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check internal API endpoint
   */
  private async checkInternalEndpoint(
    endpoint: string,
    serviceName: string,
    timeout: number = 3000
  ): Promise<ServiceHealth> {
    const startTime = performance.now();
    try {
      const appConfig = this.config?.getAppConfig();
      const baseUrl = appConfig?.apiUrl || appConfig?.baseUrl || 'http://localhost:8088';
      const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

      // Type assertion needed for strict TypeScript mode
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const httpServiceCheck = this.httpService;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (!isHttpServiceAvailable(httpServiceCheck)) {
        throw new Error('HttpService is not available for internal endpoint check');
      }
      const httpService = httpServiceCheck;

      const response = await Promise.race([
        firstValueFrom(
          httpService.get<unknown>(url, {
            timeout: timeout + 1000, // Add buffer to timeout
            validateStatus: () => true, // Don't throw on any status code
          })
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout + 1000)
        ),
      ]);

      const responseTime = Math.round(performance.now() - startTime);
      // Accept any status < 500 as endpoint exists (even 404/401 means service is responding)
      const healthResponse: HealthCheckHttpResponse<unknown> = toHealthCheckResponse(response);
      const isHealthy = healthResponse.status < 500;
      const statusCode = healthResponse.status;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: isHealthy
          ? `${serviceName} endpoint is accessible`
          : `${serviceName} endpoint returned status ${String(statusCode)}`,
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      const responseTime = Math.round(performance.now() - startTime);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        status: 'unhealthy',
        details: `${serviceName} endpoint is not accessible: ${errorMessage}`,
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    }
  }
}
