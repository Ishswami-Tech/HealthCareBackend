/**
 * Redis Service
 * @class RedisService
 * @description Low-level Redis service for cache operations with advanced features
 * Extends BaseCacheClientService for common functionality
 * Includes advanced features: SWR caching, rate limiting, metrics, circuit breaker
 */

// External imports
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
// IMPORTANT: avoid importing from the @config barrel in infra boot code (SWC TDZ/cycles).
import { ConfigService } from '@config/config.service';
import { isCacheEnabled, getCacheProvider } from '@config/cache.config';

// Internal imports - Infrastructure
import { LogType, LogLevel } from '@core/types';
import { BaseCacheClientService } from '@cache/base-cache-client.service';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { LoggerLike } from '@core/types';

@Injectable()
export class RedisService extends BaseCacheClientService implements OnModuleInit, OnModuleDestroy {
  // Provider-specific configuration
  // Provider-specific configuration - will be initialized in onModuleInit
  protected PRODUCTION_CONFIG!: {
    maxMemoryPolicy: string;
    maxConnections: number;
    connectionTimeout: number;
    commandTimeout: number;
    retryOnFailover: boolean;
    enableAutoPipelining: boolean;
    maxRetriesPerRequest: number;
    keyPrefix: string;
  };

  protected readonly PROVIDER_NAME = 'redis' as const;
  protected readonly DEFAULT_HOST = 'redis';
  protected readonly HOST_ENV_VAR = 'REDIS_HOST';
  protected readonly PORT_ENV_VAR = 'REDIS_PORT';
  protected readonly PASSWORD_ENV_VAR = 'REDIS_PASSWORD';

  // Cache strategies for different data types
  private readonly CACHE_STRATEGIES = {
    CRITICAL: { ttl: 300, compression: true }, // 5 minutes, compressed
    STANDARD: { ttl: 1800, compression: false }, // 30 minutes
    EXTENDED: { ttl: 3600, compression: true }, // 1 hour, compressed
    PERSISTENT: { ttl: 86400, compression: true }, // 24 hours, compressed
  };

  // Rate limiting configuration interface
  private readonly defaultRateLimits: Record<string, { limit: number; window: number }> = {
    api: { limit: 100, window: 60 }, // 100 requests per minute
    auth: { limit: 5, window: 60 }, // 5 login attempts per minute
    heavy: { limit: 10, window: 300 }, // 10 heavy operations per 5 minutes
  };

  // Healthcare-specific cache key patterns
  private readonly HEALTHCARE_CACHE_PATTERNS = {
    PATIENT_RECORDS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:records`,
    PATIENT_PROFILE: (patientId: string) => `patient:${patientId}:profile`,
    PATIENT_APPOINTMENTS: (patientId: string, clinicId: string) =>
      `patient:${patientId}:clinic:${clinicId}:appointments`,
    DOCTOR_PROFILE: (doctorId: string) => `doctor:${doctorId}:profile`,
    DOCTOR_SCHEDULE: (doctorId: string, date: string) => `doctor:${doctorId}:schedule:${date}`,
    DOCTOR_APPOINTMENTS: (doctorId: string, clinicId: string) =>
      `doctor:${doctorId}:clinic:${clinicId}:appointments`,
    CLINIC_INFO: (clinicId: string) => `clinic:${clinicId}:info`,
    CLINIC_DOCTORS: (clinicId: string) => `clinic:${clinicId}:doctors`,
    CLINIC_PATIENTS: (clinicId: string) => `clinic:${clinicId}:patients`,
    MEDICAL_HISTORY: (patientId: string, clinicId: string) =>
      `medical:${patientId}:clinic:${clinicId}:history`,
    PRESCRIPTIONS: (patientId: string, clinicId: string) =>
      `prescriptions:${patientId}:clinic:${clinicId}`,
    APPOINTMENT_DETAILS: (appointmentId: string) => `appointment:${appointmentId}:details`,
    USER_PERMISSIONS: (userId: string, clinicId: string) =>
      `user:${userId}:clinic:${clinicId}:permissions`,
    EMERGENCY_CONTACTS: (patientId: string) => `patient:${patientId}:emergency_contacts`,
    VITAL_SIGNS: (patientId: string, date: string) => `patient:${patientId}:vitals:${date}`,
    LAB_RESULTS: (patientId: string, clinicId: string) =>
      `lab:${patientId}:clinic:${clinicId}:results`,
  };

  // Healthcare-specific cache tags for grouped invalidation
  private readonly HEALTHCARE_CACHE_TAGS = {
    PATIENT: (patientId: string) => `patient:${patientId}`,
    DOCTOR: (doctorId: string) => `doctor:${doctorId}`,
    CLINIC: (clinicId: string) => `clinic:${clinicId}`,
    USER: (userId: string) => `user:${userId}`,
    APPOINTMENT: (appointmentId: string) => `appointment:${appointmentId}`,
    MEDICAL_RECORD: (recordId: string) => `medical_record:${recordId}`,
    PRESCRIPTION: (prescriptionId: string) => `prescription:${prescriptionId}`,
    EMERGENCY_DATA: 'emergency_data',
    CRITICAL_PATIENT_DATA: 'critical_patient_data',
    PHI_DATA: 'phi_data', // Protected Health Information
  };

  constructor(
    @Inject(forwardRef(() => ConfigService)) configService: ConfigService,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE') loggingService: LoggerLike
  ) {
    super(configService, loggingService);

    if (this.verboseLoggingEnabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Running in ${this.isDevelopment ? 'development' : 'production'} mode`,
        'CacheService',
        { environment: this.isDevelopment ? 'development' : 'production' }
      );
    }

    // Don't initialize client here - wait for onModuleInit when PRODUCTION_CONFIG is ready
    // Client initialization happens in onModuleInit() after PRODUCTION_CONFIG is set

    // CRITICAL: Connect immediately - don't wait for lifecycle hooks
    setImmediate(() => {
      if (!isCacheEnabled() || getCacheProvider() !== 'redis') {
        return;
      }

      if (this.verboseLoggingEnabled) {
        void this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Constructor: Initiating cache connection immediately',
            'RedisService',
            {}
          )
          .catch(() => {
            // Ignore logging errors
          });
      }
      void this.onModuleInit().catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void this.loggingService
          .log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Constructor: Failed to connect cache: ${errorMessage}`,
            'RedisService',
            { error: errorMessage, stack: error instanceof Error ? error.stack : undefined }
          )
          .catch(() => {
            // Ignore logging errors
          });
      });
    });
  }

  /**
   * Override setupEventHandlers to add Redis-specific event handlers
   */
  protected setupEventHandlers(host: string, port: number): void {
    super.setupEventHandlers(host, port);

    // Add Redis-specific error handling for read-only mode
    this.client.on('error', err => {
      if (err.message && err.message.includes('READONLY')) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Redis in read-only mode, attempting to fix',
          'CacheService',
          {}
        );
        this.resetReadOnlyMode().catch(resetError => {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Failed to reset read-only mode',
            'CacheService',
            {
              error: resetError instanceof Error ? resetError.message : String(resetError),
              stack: resetError instanceof Error ? resetError.stack : undefined,
            }
          );
        });
      }
    });

    this.client.on('connect', () => {
      // Check read-only status on connect
      this.checkAndResetReadOnlyMode().catch(err => {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Failed to check read-only status on connect',
          'CacheService',
          {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }
        );
      });
    });

    this.client.on('reconnecting', () => {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Reconnecting to Redis',
        'CacheService',
        {}
      );
    });

    this.client.on('end', () => {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Redis connection ended',
        'CacheService',
        {}
      );
    });
  }

  async onModuleInit() {
    // Initialize PRODUCTION_CONFIG using ConfigService
    const keyPrefix = this.configService.getEnv('REDIS_KEY_PREFIX', 'healthcare:');
    this.PRODUCTION_CONFIG = {
      maxMemoryPolicy: 'noeviction',
      maxConnections: this.configService.getEnvNumber('REDIS_MAX_CONNECTIONS', 100),
      connectionTimeout: 15000,
      commandTimeout: 5000,
      retryOnFailover: true,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 3,
      keyPrefix: keyPrefix || 'healthcare:',
    };

    // Now initialize the client after PRODUCTION_CONFIG is set
    this.initializeClient();

    // Log that onModuleInit is being called (don't await - don't block on logging)
    void this.loggingService
      .log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'CacheService onModuleInit called - START',
        'CacheService',
        {}
      )
      .catch(() => {
        // Ignore logging errors - connection is more important
      });

    try {
      // Check if cache is enabled using single source of truth
      if (!isCacheEnabled()) {
        await this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'RedisService skipped - cache is disabled',
            'RedisService',
            {}
          )
          .catch(() => {
            // Ignore logging errors
          });
        return; // Don't connect if cache is disabled
      }

      // Check if already connected to avoid duplicate connection attempts
      if (this.client && this.client.status === 'ready') {
        void this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Cache already connected, skipping connection attempt',
            'CacheService',
            {}
          )
          .catch(() => {
            // Ignore logging errors
          });
        return;
      }

      // Check if Redis is the selected cache provider using single source of truth
      const cacheProvider = getCacheProvider();
      if (cacheProvider !== 'redis') {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `RedisService skipped - using ${cacheProvider} as cache provider`,
          'RedisService',
          { cacheProvider }
        );
        return; // Don't connect if not using Redis
      }

      // Use ConfigService for all cache configuration (single source of truth)
      // The base class getHost() and getPort() methods already use ConfigService
      // We just need to ensure connection is attempted
      const redisHost = this.getHost();
      const redisPort = this.getPort();

      // Log connection attempt (don't await - don't block)
      void this.loggingService
        .log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Starting cache connection attempt to ${redisHost}:${redisPort}`,
          'CacheService',
          { host: redisHost, port: redisPort }
        )
        .catch(() => {
          // Ignore logging errors
        });

      // Retry connection with exponential backoff (up to 3 attempts)
      const maxInitialRetries = 3;
      let lastError: Error | undefined;
      let connected = false;

      for (let attempt = 1; attempt <= maxInitialRetries; attempt++) {
        try {
          // Ensure client is initialized
          if (!this.client) {
            this.initializeClient();
          }

          // Check if already connected
          if (this.client && this.client.status === 'ready') {
            connected = true;
            break;
          }

          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          if (attempt > 1) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 2), 5000);
            await this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.INFO,
              `Retrying Redis connection (attempt ${attempt}/${maxInitialRetries}) after ${waitTime}ms`,
              'CacheService',
              { host: redisHost, port: redisPort, attempt }
            );
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }

          // Attempt connection with longer timeout for initial connection
          await Promise.race([
            this.client.connect(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Connection timeout after 15 seconds')),
                15000 // 15 second timeout for initial connection
              )
            ),
          ]);

          // Verify connection with ping
          const pingResult = await Promise.race([
            this.ping(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Ping timeout')), 5000)
            ),
          ]);

          if (pingResult === 'PONG') {
            connected = true;
            break;
          }
        } catch (connectError) {
          lastError =
            connectError instanceof Error ? connectError : new Error(String(connectError));
          const errorMessage =
            connectError instanceof Error ? connectError.message : String(connectError);

          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Redis connection attempt ${attempt}/${maxInitialRetries} failed: ${errorMessage}`,
            'CacheService',
            {
              host: redisHost,
              port: redisPort,
              attempt,
              maxRetries: maxInitialRetries,
              error: errorMessage,
            }
          );

          // If this is the last attempt, we'll handle it in the outer catch
          if (attempt === maxInitialRetries) {
            throw connectError;
          }
        }
      }

      if (!connected) {
        throw lastError || new Error('Failed to connect to Redis after all retry attempts');
      }

      // Check and reset read-only mode if needed
      await this.checkAndResetReadOnlyMode();

      // Log successful connection
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `✓ Cache connected to ${redisHost}:${redisPort}`,
        'CacheService',
        { host: redisHost, port: redisPort }
      );
    } catch (_error) {
      // Determine default host based on environment using ConfigService (uses dotenv)
      const isDocker =
        this.configService.getEnvBoolean('DOCKER_ENV', false) ||
        this.configService.hasEnv('KUBERNETES_SERVICE_HOST') ||
        this.configService.getRedisHost() === 'redis';
      const defaultHost = isDocker ? 'redis' : 'localhost';

      const redisHost = this.configService.getRedisHost() || defaultHost;
      const redisPort = this.configService.getRedisPort();

      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const errorCode = (_error as { code?: string })?.code || 'UNKNOWN';

      // Log error using LoggingService instead of console.error
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize Redis connection: ${errorMessage} (${errorCode})`,
        'RedisService',
        {
          error: errorMessage,
          errorCode,
          stack: _error instanceof Error ? _error.stack : 'No stack trace',
        }
      );

      // CRITICAL: Don't throw - allow app to start in degraded mode without Redis
      // This enables graceful degradation when Redis is unavailable
      // Log from CacheService context since that's the public interface
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `Failed to initialize cache connection to ${redisHost}:${redisPort} - application will run in degraded mode without caching. Error: ${errorMessage} (${errorCode})`,
        'CacheService',
        {
          error: errorMessage,
          errorCode,
          host: redisHost,
          port: redisPort,
          environment: {
            REDIS_HOST: this.configService.getEnv('REDIS_HOST'),
            REDIS_PORT: this.configService.getEnv('REDIS_PORT'),
            DOCKER_ENV: this.configService.getEnv('DOCKER_ENV'),
            NODE_ENV: this.configService.getEnvironment(),
            isDocker,
            defaultHost,
          },
          stack: _error instanceof Error ? _error.stack : undefined,
          troubleshooting: {
            message: 'Please ensure Redis is running and accessible',
            docker: 'If using Docker, ensure Redis container is running: docker ps | grep redis',
            dockerNetwork:
              'If in Docker, verify network connectivity: docker exec healthcare-api ping -c 1 redis',
            local: 'If running locally, ensure Redis is installed and running: redis-cli ping',
            connection: `Check connection: redis-cli -h ${redisHost} -p ${redisPort} ping`,
            disable: this.isDevelopment
              ? 'To disable Redis in development, set REDIS_ENABLED=false'
              : undefined,
          },
        }
      );
      // Open circuit breaker immediately to prevent repeated connection attempts
      this.circuitBreakerOpen = true;
      this.circuitBreakerFailures = this.circuitBreakerThreshold;
      this.circuitBreakerLastFailureTime = Date.now();
      // Don't throw - allow application to continue without Redis
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  /**
   * Advanced caching methods for 1M+ users
   */

  // Auto-scaling cache management
  async optimizeMemoryUsage(): Promise<void> {
    if (this.configService.isProduction()) {
      await this.client.config('SET', 'maxmemory-policy', this.PRODUCTION_CONFIG.maxMemoryPolicy);
      await this.client.config('SET', 'maxmemory', '2gb'); // Adjust based on available memory
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Applied production memory optimizations',
        'CacheService',
        {}
      );
    }
  }

  // Check if Redis is in read-only mode and reset if needed
  async checkAndResetReadOnlyMode(): Promise<boolean> {
    try {
      const info = await this.client.info('replication');
      const isReadOnly = info.includes('role:slave') || info.includes('slave_read_only:1');

      if (isReadOnly) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Redis is in read-only mode, attempting to reset',
          'CacheService',
          {}
        );
        return await this.resetReadOnlyMode();
      }

      return true;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to check Redis read-only status',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false;
    }
  }

  // Reset read-only mode
  async resetReadOnlyMode(): Promise<boolean> {
    try {
      // Try to disable read-only mode
      await this.client.config('SET', 'slave-read-only', 'no');
      // Disconnect from master if we're a replica
      await this.client.call('REPLICAOF', 'NO', 'ONE');

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Successfully reset Redis read-only mode',
        'CacheService',
        {}
      );
      return true;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to reset Redis read-only mode',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false;
    }
  }

  /**
   * Ensure Redis is connected before operations
   * This is called automatically by retryOperation, but can be called manually
   */
  private async ensureConnected(): Promise<void> {
    // If client doesn't exist, initialize it
    if (!this.client) {
      this.initializeClient();
    }

    // If not connected, try to connect
    const status = this.client?.status as string;
    if (status !== 'ready') {
      // Try to connect if not in a transitional state
      const transitionalStates = ['connecting', 'connect', 'wait', 'reconnecting'];
      if (!transitionalStates.includes(status)) {
        try {
          await this.client.connect();
          await this.ping();
          // Connection successful, reset circuit breaker
          this.circuitBreakerOpen = false;
          this.circuitBreakerFailures = 0;
          const currentHost = this.configService.getRedisHost() || 'redis';
          const currentPort = this.configService.getRedisPort();
          void this.loggingService
            .log(
              LogType.SYSTEM,
              LogLevel.INFO,
              `Redis connected to ${currentHost}:${currentPort}`,
              'CacheService',
              { host: currentHost, port: currentPort }
            )
            .catch(() => {
              // Ignore logging errors
            });
        } catch (connectError) {
          // Connection failed, will be handled by retryOperation
          const errorMessage =
            connectError instanceof Error ? connectError.message : String(connectError);
          void this.loggingService
            .log(
              LogType.SYSTEM,
              LogLevel.WARN,
              `Failed to connect Redis on first use: ${errorMessage}`,
              'CacheService',
              { error: errorMessage }
            )
            .catch(() => {
              // Ignore logging errors
            });
        }
      }
    }
  }

  // Make retryOperation public for rate limiting service
  public async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    // Check if Redis client is ready before attempting operation
    // This prevents circuit breaker from opening during initialization
    const clientStatus = this.client?.status as string;
    if (!this.client || clientStatus !== 'ready') {
      // Redis is not ready - don't count as failure, just throw error
      // This allows callers to handle gracefully without opening circuit breaker
      throw new HealthcareError(
        ErrorCode.CACHE_CONNECTION_FAILED,
        'Redis is not ready yet - please wait for connection to be established',
        undefined,
        {
          redisReady: false,
          clientStatus: clientStatus || 'not initialized',
        },
        'RedisService.retryOperation'
      );
    }

    // Ensure connection before attempting operation
    await this.ensureConnected();
    // Check circuit breaker - fail fast if circuit is open
    if (this.circuitBreakerOpen) {
      const timeSinceLastFailure = Date.now() - this.circuitBreakerLastFailureTime;
      if (timeSinceLastFailure < this.circuitBreakerResetTimeout) {
        // Circuit is still open - throw error for operations that require Redis
        // This allows callers to handle gracefully
        throw new HealthcareError(
          ErrorCode.CACHE_CONNECTION_FAILED,
          'Redis circuit breaker is open - too many consecutive failures. Redis may be unavailable.',
          undefined,
          {
            circuitBreakerOpen: true,
            timeUntilReset: this.circuitBreakerResetTimeout - timeSinceLastFailure,
          },
          'RedisService.retryOperation'
        );
      } else {
        // Reset circuit breaker and attempt to reconnect
        this.circuitBreakerOpen = false;
        this.circuitBreakerFailures = 0;
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Redis circuit breaker reset - attempting to reconnect',
          'CacheService',
          {}
        );

        // Attempt to reconnect if client is not ready
        await this.attemptReconnection();
      }
    }

    // Check if Redis client is connected before retrying (clientStatus already checked above)
    if (!this.client || (this.client?.status as string) !== 'ready') {
      // If client doesn't exist, initialize it
      if (!this.client) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Redis client not initialized, initializing now',
          'CacheService',
          {}
        );
        this.initializeClient();
      }

      // Only attempt reconnection if not in a transitional state
      // Transitional states mean Redis is already handling the connection
      const transitionalStates = ['connecting', 'connect', 'wait', 'reconnecting'];
      if (!transitionalStates.includes(clientStatus)) {
        // Attempt to reconnect before failing
        await this.attemptReconnection();
      } else {
        // Wait a bit for transitional state to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Check again after reconnection attempt or wait
      const finalStatus = this.client?.status as string;
      if (!this.client || finalStatus !== 'ready') {
        // If still not ready, try one more time to connect
        if (finalStatus === 'end' || finalStatus === 'close' || !finalStatus) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Redis client status is '${finalStatus}', attempting direct connection`,
            'CacheService',
            { status: finalStatus }
          );
          try {
            await this.client.connect();
            await this.ping();
            // Connection successful, reset circuit breaker
            this.circuitBreakerOpen = false;
            this.circuitBreakerFailures = 0;
            // Connection is now ready, continue with the operation
            // Break out of the check and proceed to execute the operation
          } catch (connectError) {
            // Connection failed, continue to error handling
            const errorMessage =
              connectError instanceof Error ? connectError.message : String(connectError);
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.WARN,
              `Direct connection attempt failed: ${errorMessage}`,
              'CacheService',
              { error: errorMessage, status: finalStatus }
            );
          }
        }

        this.recordCircuitBreakerFailure();
        const redisHost = this.configService.getRedisHost() || 'redis';
        const redisPort = this.configService.getRedisPort();

        throw new HealthcareError(
          ErrorCode.CACHE_CONNECTION_FAILED,
          `Redis client is not connected to ${redisHost}:${redisPort}. Please ensure Redis is available and connection is established.`,
          undefined,
          {
            clientStatus: this.client?.status || 'not initialized',
            host: redisHost,
            port: redisPort,
          },
          'RedisService.retryOperation'
        );
      }
    }

    let lastError;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const result = await operation();
        // Success - reset circuit breaker
        if (i > 0) {
          // Only log if we had to retry
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Redis operation succeeded after ${i} retries`,
            'CacheService',
            { retries: i }
          );
        }
        this.circuitBreakerFailures = 0;
        return result;
      } catch (_error) {
        lastError = _error;
        // Only log retry attempts, not every failure
        if (i < this.maxRetries - 1) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Redis operation failed, retrying (${i + 1}/${this.maxRetries})`,
            'CacheService',
            {
              attempt: i + 1,
              maxRetries: this.maxRetries,
              error: _error instanceof Error ? _error.message : String(_error),
            }
          );
        }

        // Check if it's a read-only error and try to fix it
        if ((_error as Error).message && (_error as Error).message.includes('READONLY')) {
          try {
            await this.resetReadOnlyMode();
          } catch (resetError) {
            // Just log the error, we'll retry the operation anyway
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'Failed to reset read-only mode during retry',
              'CacheService',
              {
                error: resetError instanceof Error ? resetError.message : String(resetError),
                stack: resetError instanceof Error ? resetError.stack : undefined,
              }
            );
          }
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (i + 1)));
      }
    }

    // All retries failed - record circuit breaker failure
    this.recordCircuitBreakerFailure();
    throw lastError;
  }

  /**
   * Record circuit breaker failure and open circuit if threshold is reached
   * Only records failures when Redis client is ready (not during initialization)
   */
  private recordCircuitBreakerFailure(): void {
    // Don't count failures if Redis is not ready yet (during initialization)
    // This prevents circuit breaker from opening during startup
    const clientStatus = this.client?.status as string;
    if (!this.client || clientStatus !== 'ready') {
      // Redis is not ready - don't count as failure
      return;
    }

    this.circuitBreakerFailures++;
    this.circuitBreakerLastFailureTime = Date.now();

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold && !this.circuitBreakerOpen) {
      this.circuitBreakerOpen = true;
      // CRITICAL: Log circuit breaker opening - this is important for monitoring
      // But use CacheService context since that's the public interface
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        `Cache circuit breaker opened after ${this.circuitBreakerFailures} consecutive failures. Application running in degraded mode without cache. Circuit breaker will reset after ${this.circuitBreakerResetTimeout}ms.`,
        'CacheService',
        {
          failures: this.circuitBreakerFailures,
          resetTimeout: this.circuitBreakerResetTimeout,
          degradedMode: true,
        }
      );
    }
  }

  /**
   * Attempt to reconnect to Redis if connection is lost
   * Prevents multiple simultaneous reconnection attempts
   */
  private async attemptReconnection(): Promise<boolean> {
    try {
      if (!this.client) {
        // Client was never initialized, reinitialize it
        this.initializeClient();
      }

      // Check current connection status
      const status = this.client.status as string;

      // Already connected - no need to reconnect
      if (status === 'ready') {
        return true;
      }

      // Transitional states - Redis is already connecting, just wait
      // These states mean Redis is handling the connection, don't interfere
      const transitionalStates = ['connecting', 'connect', 'wait', 'reconnecting'];
      if (transitionalStates.includes(status)) {
        // Wait a bit for connection to complete, then check status
        await new Promise(resolve => setTimeout(resolve, 500));
        return this.client.status === 'ready';
      }

      // Check if we're already attempting to reconnect
      const now = Date.now();
      if (this.isReconnecting) {
        // Wait for existing reconnection attempt to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.client.status === 'ready';
      }

      // Check cooldown period to prevent rapid reconnection attempts
      if (now - this.lastReconnectionAttempt < this.RECONNECTION_COOLDOWN) {
        // Too soon since last attempt, just check current status
        return this.client.status === 'ready';
      }

      // Only attempt reconnection if status is clearly disconnected
      // Disconnected states: 'end', 'close', 'error', or undefined
      const disconnectedStates = ['end', 'close', 'error'];
      if (!disconnectedStates.includes(status) && status !== undefined) {
        // Unknown state, don't attempt reconnection
        return false;
      }

      // Set reconnection lock
      this.isReconnecting = true;
      this.lastReconnectionAttempt = now;

      try {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Attempting to reconnect to Redis (current status: ${status})`,
          'CacheService',
          { status }
        );

        await this.client.connect();
        await this.ping();

        const reconnectHost = this.configService.getRedisHost() || 'redis';
        const reconnectPort = this.configService.getRedisPort();
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Redis connected to ${reconnectHost}:${reconnectPort}`,
          'CacheService',
          { host: reconnectHost, port: reconnectPort }
        );

        // Reset circuit breaker on successful reconnection
        this.circuitBreakerFailures = 0;
        this.circuitBreakerOpen = false;
        return true;
      } catch (connectError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          'Failed to reconnect to Redis',
          'CacheService',
          {
            error: connectError instanceof Error ? connectError.message : String(connectError),
            status: this.client.status,
          }
        );
        return false;
      } finally {
        // Always release reconnection lock
        this.isReconnecting = false;
      }
    } catch (error) {
      this.isReconnecting = false;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error during reconnection attempt',
        'CacheService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return false;
    }
  }

  // ===== OVERRIDE BASIC OPERATIONS TO USE RETRY OPERATION =====
  // These override base class methods to add retryOperation wrapper

  async set(key: string, value: string, ttl?: number): Promise<void>;
  async set<T>(key: string, value: T, ttl?: number): Promise<void>;
  async set<T>(key: string, value: T | string, ttl?: number): Promise<void> {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      await this.retryOperation(async () => {
        if (ttl) {
          await this.client.setex(key, ttl, serializedValue);
        } else {
          await this.client.set(key, serializedValue);
        }
      });
    } catch (_error) {
      // Fail silently - graceful degradation
    }
  }

  async get(key: string): Promise<string | null>;
  async get<T>(key: string): Promise<T | null>;
  async get<T>(key: string): Promise<T | string | null> {
    try {
      const result = await this.retryOperation(() => this.client.get(key));
      if (result === null) return null;

      try {
        return JSON.parse(result) as T;
      } catch {
        return result as T;
      }
    } catch (_error) {
      return null;
    }
  }

  // Override del to use retryOperation
  async del(key: string): Promise<number>;
  async del(...keys: string[]): Promise<number>;
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.retryOperation(() => this.client.del(...keys));
  }

  // Override exists to use retryOperation
  async exists(key: string): Promise<number> {
    return this.retryOperation(() => this.client.exists(key));
  }

  async keys(pattern: string): Promise<string[]> {
    return this.retryOperation(() => this.client.keys(pattern));
  }

  async ttl(key: string): Promise<number> {
    return this.retryOperation(() => this.client.ttl(key));
  }

  async ping(): Promise<string> {
    // Direct ping without retryOperation to avoid circular dependency
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    if (this.client.status !== 'ready') {
      throw new Error(`Redis client not ready, status: ${this.client.status}`);
    }
    return this.client.ping();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const pingResult = await this.ping();
      return pingResult === 'PONG';
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Redis health check failed',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false;
    }
  }

  async getCacheDebug(): Promise<Record<string, unknown>> {
    try {
      const [info, dbSize, memoryInfo] = await Promise.all([
        this.client.info(),
        this.client.dbsize(),
        this.client.info('memory'),
      ]);

      const connectedClients = parseInt(info.match(/connected_clients:(\d+)/)?.[1] || '0');
      const usedMemory = parseInt(memoryInfo.match(/used_memory:(\d+)/)?.[1] || '0');

      return {
        status: 'ok',
        info: {
          dbSize,
          memoryInfo: {
            usedMemory,
            connectedClients,
          },
          serverInfo: info,
        },
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get Redis debug info',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // ===== OVERRIDE HASH OPERATIONS TO USE RETRY OPERATION =====

  async hSet(key: string, field: string, value: string): Promise<number> {
    return this.retryOperation(() => this.client.hset(key, field, value));
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.retryOperation(() => this.client.hget(key, field));
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.retryOperation(() => this.client.hgetall(key));
  }

  async hDel(key: string, field: string): Promise<number> {
    return this.retryOperation(() => this.client.hdel(key, field));
  }

  // ===== OVERRIDE LIST OPERATIONS TO USE RETRY OPERATION =====

  async rPush(key: string, value: string): Promise<number> {
    return this.retryOperation(() => this.client.rpush(key, value));
  }

  // Override lTrim to use retryOperation
  async lTrim(key: string, start: number, stop: number): Promise<string> {
    await this.retryOperation(() => this.client.ltrim(key, start, stop));
    return 'OK';
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.retryOperation(() => this.client.lrange(key, start, stop));
  }

  async lLen(key: string): Promise<number> {
    return this.retryOperation(() => this.client.llen(key));
  }

  // ===== OVERRIDE SET OPERATIONS TO USE RETRY OPERATION =====

  async sAdd(key: string, ...members: string[]): Promise<number> {
    return this.retryOperation(() => this.client.sadd(key, ...members));
  }

  async sMembers(key: string): Promise<string[]> {
    return this.retryOperation(() => this.client.smembers(key));
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.retryOperation(() => this.client.srem(key, ...members));
  }

  async sCard(key: string): Promise<number> {
    return this.retryOperation(() => this.client.scard(key));
  }

  // ===== OVERRIDE PUB/SUB OPERATIONS =====

  async publish(channel: string, message: string): Promise<number> {
    return this.retryOperation(() => this.client.publish(channel, message));
  }

  // ===== OVERRIDE EXPIRY OPERATIONS TO USE RETRY OPERATION =====

  async expire(key: string, seconds: number): Promise<number> {
    return this.retryOperation(() => this.client.expire(key, seconds));
  }

  async expireAt(key: string, timestamp: number): Promise<number> {
    return this.retryOperation(() => this.client.expireat(key, timestamp));
  }

  // Security event tracking
  async trackSecurityEvent(identifier: string, eventType: string, details: unknown): Promise<void> {
    const event = {
      timestamp: new Date(),
      eventType,
      identifier,
      details,
    };

    await this.retryOperation(async () => {
      const eventKey = `security:events:${identifier}`;

      // Add event to the list
      await this.client.rpush(eventKey, JSON.stringify(event));

      // Trim list to keep only last 1000 events
      await this.client.ltrim(eventKey, -1000, -1);

      // Set expiry for events list
      await this.client.expire(eventKey, this.SECURITY_EVENT_RETENTION);
    });

    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.DEBUG,
      'Security event tracked',
      'CacheService',
      { eventType, identifier }
    );
  }

  async getSecurityEvents(
    identifier: string,
    limit: number = 100
  ): Promise<Array<Record<string, unknown>>> {
    const eventKey = `security:events:${identifier}`;
    const events = await this.retryOperation(() => this.client.lrange(eventKey, -limit, -1));

    return events.map((event: string) => JSON.parse(event) as Record<string, unknown>);
  }

  async clearSecurityEvents(identifier: string): Promise<void> {
    const eventKey = `security:events:${identifier}`;
    await this.retryOperation(() => this.client.del(eventKey));
  }

  // Cache statistics methods
  async incrementCacheStats(type: 'hits' | 'misses'): Promise<void> {
    await this.retryOperation(() => this.client.hincrby(this.STATS_KEY, type, 1));
  }

  async getCacheStats(): Promise<{ hits: number; misses: number }> {
    const stats = await this.retryOperation(() => this.client.hgetall(this.STATS_KEY));
    return {
      hits: parseInt(stats?.['hits'] || '0'),
      misses: parseInt(stats?.['misses'] || '0'),
    };
  }

  async clearAllCache(): Promise<number> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.WARN,
      'Clearing all cache',
      'CacheService',
      {}
    );

    try {
      // Get all keys
      const keys = await this.keys('*');

      if (keys.length === 0) {
        return 0;
      }

      // Filter out system keys
      const keysToDelete = keys.filter(
        key =>
          !key.startsWith('cache:stats') &&
          !key.startsWith('security:events') &&
          !key.startsWith('system:')
      );

      if (keysToDelete.length === 0) {
        return 0;
      }

      // Delete keys in batches to avoid blocking
      const BATCH_SIZE = 1000;
      let deletedCount = 0;

      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          deletedCount += count;
        }
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Cleared keys from cache',
        'CacheService',
        { deletedCount }
      );
      return deletedCount;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error clearing all cache',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async resetCacheStats(): Promise<void> {
    await this.retryOperation(() => this.client.del(this.STATS_KEY));
  }

  async getCacheMetrics(): Promise<import('@core/types').CacheMetrics> {
    const [stats, info, dbSize] = await Promise.all([
      this.getCacheStats(),
      this.client.info('memory'),
      this.client.dbsize(),
    ]);

    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
    const peakMemory = parseInt(info.match(/used_memory_peak:(\d+)/)?.[1] || '0');
    const fragmentationRatio = parseFloat(
      info.match(/mem_fragmentation_ratio:(\d+\.\d+)/)?.[1] || '0'
    );

    const hitRate =
      stats.hits + stats.misses > 0 ? (stats.hits / (stats.hits + stats.misses)) * 100 : 0;

    return {
      keys: dbSize,
      hitRate,
      memory: {
        used: usedMemory,
        peak: peakMemory,
        fragmentation: fragmentationRatio,
      },
      operations: {
        hits: stats.hits,
        misses: stats.misses,
      },
    };
  }

  // Enhanced rate limiting methods
  async isRateLimited(
    key: string,
    limit?: number,
    windowSeconds?: number,
    options: {
      burst?: number; // Allow burst requests
      cost?: number; // Request cost (default: 1)
      bypassDev?: boolean; // Override development mode bypass
    } = {}
  ): Promise<boolean> {
    // Check development mode bypass
    if (this.isDevelopment && !options.bypassDev) {
      return false;
    }

    // Get default limits if not specified
    const type = key.split(':')[0] || 'api';
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits['api'];
    if (defaultLimit) {
      limit = limit || defaultLimit.limit;
      windowSeconds = windowSeconds || defaultLimit.window;
    }

    // Ensure we have valid values
    if (!limit || !windowSeconds) {
      throw new HealthcareError(
        ErrorCode.CACHE_CONFIGURATION_ERROR,
        'Rate limit configuration missing',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { key, type },
        'RedisService.isRateLimited'
      );
    }

    try {
      const multi = this.client.multi();
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const cost = options.cost || 1;
      const burstLimit = options.burst ? limit + options.burst : limit;

      // Remove old entries
      multi.zremrangebyscore(key, 0, now - windowMs);

      // Add current request with cost
      multi.zadd(key, now, `${now}-${Math.random()}-${cost}`);

      // Get total cost of requests in window
      multi.zcard(key);

      // Set expiry on the set
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      const current =
        results &&
        Array.isArray(results) &&
        results[2] &&
        Array.isArray(results[2]) &&
        results[2][1] !== undefined &&
        results[2][1] !== null
          ? parseInt(
              typeof results[2][1] === 'string' || typeof results[2][1] === 'number'
                ? String(results[2][1])
                : '0',
              10
            )
          : 0;

      // Check against burst limit if specified, otherwise normal limit
      return current * cost > (options.burst ? burstLimit : limit);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Rate limiting error',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false; // Fail open in case of errors
    }
  }

  async getRateLimit(
    key: string,
    limit?: number,
    windowSeconds?: number
  ): Promise<{
    remaining: number;
    reset: number;
    total: number;
    used: number;
  }> {
    // Development mode check
    if (this.isDevelopment) {
      return {
        remaining: 999999,
        reset: 0,
        total: 999999,
        used: 0,
      };
    }

    // Get default limits if not specified
    const type = key.split(':')[0] || 'api';
    const defaultLimit = this.defaultRateLimits[type] || this.defaultRateLimits['api'];
    if (defaultLimit) {
      limit = limit || defaultLimit.limit;
      windowSeconds = windowSeconds || defaultLimit.window;
    }

    // Ensure we have valid values
    if (!limit || !windowSeconds) {
      throw new HealthcareError(
        ErrorCode.CACHE_CONFIGURATION_ERROR,
        'Rate limit configuration missing',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { key, type },
        'RedisService.isRateLimited'
      );
    }

    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;

      // Clean up old entries first
      await this.client.zremrangebyscore(key, 0, now - windowMs);

      const [count, ttl] = await Promise.all([this.client.zcard(key), this.client.ttl(key)]);

      return {
        remaining: Math.max(0, limit - count),
        reset: Math.max(0, ttl),
        total: limit,
        used: count,
      } as { remaining: number; reset: number; total: number; used: number };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error getting rate limit',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return {
        remaining: 0,
        reset: 0,
        total: limit || 0,
        used: 0,
      };
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    try {
      await this.client.del(key);
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Rate limit cleared',
        'CacheService',
        { key }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error clearing rate limit',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  // Method to update rate limit configuration
  updateRateLimits(type: string, config: { limit: number; window: number }): Promise<void> {
    this.defaultRateLimits[type] = config;
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Updated rate limits',
      'CacheService',
      { type, config: JSON.stringify(config) }
    );
    return Promise.resolve();
  }

  // Method to get current rate limit configuration
  getRateLimitConfig(
    type?: string
  ): { limit: number; window: number } | Record<string, { limit: number; window: number }> {
    if (type) {
      const config = this.defaultRateLimits[type];
      if (config) {
        return config;
      }
      const defaultConfig = this.defaultRateLimits['api'];
      if (!defaultConfig) {
        throw new HealthcareError(
          ErrorCode.CACHE_CONFIGURATION_ERROR,
          'Default rate limit configuration missing',
          HttpStatus.INTERNAL_SERVER_ERROR,
          { type },
          'RedisService.getRateLimitConfig'
        );
      }
      return defaultConfig;
    }
    return this.defaultRateLimits;
  }

  // Development mode helper
  isDevelopmentMode(): boolean {
    return this.isDevelopment;
  }

  // ===== OVERRIDE SORTED SET OPERATIONS TO USE RETRY OPERATION =====

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.retryOperation(() => this.client.zremrangebyscore(key, min, max));
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.retryOperation(() => this.client.zadd(key, score, member));
  }

  async zcard(key: string): Promise<number> {
    return this.retryOperation(() => this.client.zcard(key));
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.retryOperation(() => this.client.zrevrange(key, start, stop));
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    return this.retryOperation(() => this.client.zrangebyscore(key, min, max));
  }

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    return this.retryOperation(async () => {
      const pipeline = this.client.pipeline();
      commands.forEach(cmd => {
        const pipelineAsAny = pipeline as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        const method = pipelineAsAny[cmd.command];
        if (method && typeof method === 'function') {
          method.apply(pipeline, cmd.args);
        }
      });
      return pipeline.exec() as Promise<Array<[Error | null, unknown]>>;
    });
  }

  // ===== OVERRIDE UTILITY OPERATIONS TO USE RETRY OPERATION =====

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.retryOperation(() => this.client.hincrby(key, field, increment));
  }

  async incr(key: string): Promise<number> {
    return this.retryOperation(() => this.client.incr(key));
  }

  /**
   * Gets the health status of the Redis connection.
   * Returns a tuple with health status boolean and ping time in milliseconds.
   */
  async getHealthStatus(): Promise<[boolean, number]> {
    try {
      const startTime = Date.now();
      const pingResult = await this.ping();
      const pingTime = Date.now() - startTime;

      return [pingResult === 'PONG', pingTime];
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Redis health check failed',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return [false, 0];
    }
  }

  /**
   * Override clearCache to add logging and batch processing
   */
  async clearCache(pattern?: string): Promise<number> {
    await this.loggingService.log(
      LogType.CACHE,
      LogLevel.INFO,
      'Clearing cache with pattern',
      'CacheService',
      { pattern: pattern || 'ALL' }
    );

    try {
      if (!pattern) {
        return await this.clearAllCache();
      }

      const keys = await this.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      // Delete keys in batches
      const BATCH_SIZE = 1000;
      let deletedCount = 0;

      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          deletedCount += count;
        }
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Cleared keys matching pattern',
        'CacheService',
        { deletedCount, pattern }
      );
      return deletedCount;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error clearing cache with pattern',
        'CacheService',
        {
          pattern,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Unified caching service that handles all caching operations.
   * This is the main method to use for all caching needs with built-in SWR.
   *
   * @param key - Cache key
   * @param fetchFn - Function to fetch data
   * @param options - Caching options
   * @returns Cached or fresh data
   */
  async cache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: {
      ttl?: number; // Cache TTL in seconds
      staleTime?: number; // When data becomes stale
      forceRefresh?: boolean; // Force refresh regardless of cache
      compress?: boolean; // Compress large data
      priority?: 'critical' | 'high' | 'normal' | 'low'; // Operation priority
      enableSwr?: boolean; // Enable SWR (defaults to true)
      tags?: string[]; // Cache tags for grouped invalidation
      containsPHI?: boolean; // Contains Protected Health Information
      complianceLevel?: 'standard' | 'sensitive' | 'restricted'; // Compliance level
      emergencyData?: boolean; // Emergency data flag
      patientSpecific?: boolean; // Patient-specific data
      doctorSpecific?: boolean; // Doctor-specific data
      clinicSpecific?: boolean; // Clinic-specific data
    } = {}
  ): Promise<T> {
    const {
      ttl = 3600,
      staleTime = Math.floor(ttl / 2),
      forceRefresh = false,
      compress = false,
      priority = 'high',
      enableSwr = true,
      tags = [],
    } = options;

    // Add tags to this key if provided
    if (tags.length > 0) {
      await this.addKeyToTags(key, tags);
    }

    // If SWR is disabled, use standard caching
    if (!enableSwr) {
      return this.standardCacheFetch(key, fetchFn, ttl, forceRefresh);
    }

    const revalidationKey = `${key}:revalidating`;

    try {
      // Use pipelining to reduce round-trips to Redis
      const pipelineResults = await this.retryOperation(async () => {
        const pipeline = this.client.pipeline();
        pipeline.get(revalidationKey);
        pipeline.get(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();
        return results?.map(result => result[1]) || [];
      });
      const isRevalidating = pipelineResults[0] as string | null | undefined;
      const cachedData = pipelineResults[1] as string | null | undefined;
      const remainingTtlRaw = pipelineResults[2] as number | null | undefined;

      // Convert TTL to number
      const remainingTtl = typeof remainingTtlRaw === 'number' ? remainingTtlRaw : 0;

      // Cache miss or forced refresh
      if (!cachedData || forceRefresh) {
        await this.incrementCacheStats('misses');

        // Skip locking for low priority operations under high load
        if (priority === 'low' && (await this.isHighLoad())) {
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.DEBUG,
            'Skipping lock acquisition for low priority operation',
            'CacheService',
            { key }
          );
        } else {
          // Set revalidation flag with a short expiry
          await this.set(revalidationKey, 'true', 30);
        }

        try {
          const freshData = await fetchFn();

          // Only cache valid data
          if (freshData !== undefined && freshData !== null) {
            // Store data with optional compression
            if (compress) {
              await this.setCompressed(key, freshData, ttl);
            } else {
              await this.set(key, JSON.stringify(freshData), ttl);
            }
          }

          // Clear revalidation flag
          await this.del(revalidationKey);

          return freshData;
        } catch (_error) {
          // Clear revalidation flag on _error
          await this.del(revalidationKey);
          throw _error;
        }
      }

      // Record cache hit
      await this.incrementCacheStats('hits');

      // Check if we're in the stale period
      const isStale = remainingTtl <= staleTime;

      // If stale and not already revalidating, trigger background refresh
      if (isStale && !isRevalidating) {
        // Skip background revalidation for low priority during high load
        if (priority === 'low' && (await this.isHighLoad())) {
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.DEBUG,
            'Skipping background revalidation for low priority cache',
            'CacheService',
            { key }
          );
        } else {
          // Use set with NX option to prevent race conditions
          const lockAcquired = await this.retryOperation(() =>
            this.client.set(revalidationKey, 'true', 'EX', 30, 'NX')
          );

          if (lockAcquired) {
            // Background revalidation with optimized lock
            this.backgroundRevalidate(key, fetchFn, ttl, revalidationKey, compress, tags).catch(
              err =>
                void this.loggingService.log(
                  LogType.ERROR,
                  LogLevel.ERROR,
                  'Background revalidation failed',
                  'CacheService',
                  {
                    key,
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                  }
                )
            );
          }
        }
      }

      // Return cached data immediately
      return compress ? await this.getDecompressed<T>(cachedData) : (JSON.parse(cachedData) as T);
    } catch (_error) {
      void this.loggingService.log(LogType.ERROR, LogLevel.ERROR, 'Cache error', 'CacheService', {
        key,
        error: _error instanceof Error ? _error.message : String(_error),
        stack: _error instanceof Error ? _error.stack : undefined,
      });

      // If anything fails, fall back to direct fetch
      try {
        return await fetchFn();
      } catch (fetchError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Fallback fetch also failed',
          'CacheService',
          {
            key,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            stack: fetchError instanceof Error ? fetchError.stack : undefined,
          }
        );
        throw fetchError;
      }
    }
  }

  /**
   * Invalidate a specific cache key.
   *
   * @param key - The cache key to invalidate
   * @returns Boolean indicating success
   */
  async invalidateCache(key: string): Promise<boolean> {
    try {
      await this.del(key);
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Invalidated cache for key',
        'CacheService',
        { key }
      );
      return true;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to invalidate cache for key',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false;
    }
  }

  /**
   * Invalidate multiple cache keys by pattern.
   *
   * @param pattern - Pattern to match keys for invalidation (e.g., "user:*")
   * @returns Number of keys invalidated
   */
  async invalidateCacheByPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      // Delete keys in batches
      const BATCH_SIZE = 1000;
      let invalidatedCount = 0;

      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          invalidatedCount += count;
        }
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Invalidated keys matching pattern',
        'CacheService',
        { invalidatedCount, pattern }
      );
      return invalidatedCount;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to invalidate cache by pattern',
        'CacheService',
        {
          pattern,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return 0;
    }
  }

  /**
   * Invalidate cache by tag.
   * Use tags to group related cache entries for easier invalidation.
   *
   * @param tag - Tag name to invalidate
   * @returns Number of keys invalidated
   */
  async invalidateCacheByTag(tag: string): Promise<number> {
    try {
      const tagKey = `tag:${tag}`;
      const keys = await this.sMembers(tagKey);

      if (keys.length === 0) {
        return 0;
      }

      // Delete all keys in the tag
      const BATCH_SIZE = 1000;
      let invalidatedCount = 0;

      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          const count = await this.retryOperation(() => this.client.del(...batch));
          invalidatedCount += count;
        }
      }

      // Clean up the tag itself
      await this.del(tagKey);

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Invalidated keys with tag',
        'CacheService',
        { invalidatedCount, tag }
      );
      return invalidatedCount;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to invalidate cache by tag',
        'CacheService',
        {
          tag,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return 0;
    }
  }

  /**
   * Associate a key with one or more tags for grouped invalidation.
   *
   * @param key - Cache key to tag
   * @param tags - Array of tags to associate with the key
   */
  private async addKeyToTags(key: string, tags: string[]): Promise<void> {
    try {
      for (const tag of tags) {
        const tagKey = `tag:${tag}`;
        await this.sAdd(tagKey, key);

        // Set expiration on tag to prevent forever growth
        const keyTtl = await this.ttl(key);

        // If key exists and has TTL, set tag expiry to match the longest-lived key
        if (keyTtl > 0) {
          const tagTtl = await this.ttl(tagKey);
          // Only update if the current key has a longer TTL than the tag
          if (tagTtl === -1 || keyTtl > tagTtl) {
            await this.expire(tagKey, keyTtl + 60); // Add buffer time
          }
        }
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to add key to tags',
        'CacheService',
        {
          key,
          tags: tags.join(', '),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  /**
   * Enhanced background revalidation with adaptive retry and circuit breaking.
   */
  private async backgroundRevalidate<T>(
    key: string,
    fetchFn: () => Promise<T>,
    cacheTtl: number,
    revalidationKey: string,
    compression: boolean = false,
    tags: string[] = []
  ): Promise<void> {
    try {
      // Check system load before proceeding
      if (await this.isHighLoad()) {
        // Under high load, extend the TTL of the existing cache to reduce pressure
        await this.client.expire(key, cacheTtl);
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Extended TTL due to high system load',
          'CacheService',
          { key }
        );
        return;
      }

      // Fetch fresh data
      const freshData = await fetchFn();

      // Update cache with fresh data if valid
      if (freshData !== undefined && freshData !== null) {
        if (compression) {
          await this.setCompressed(key, freshData, cacheTtl);
        } else {
          // Use pipeline to set data and update metadata in one go
          await this.retryOperation(async () => {
            const pipeline = this.client.pipeline();
            pipeline.set(key, JSON.stringify(freshData));
            pipeline.expire(key, cacheTtl);
            await pipeline.exec();
          });
        }

        // Update tags if needed
        if (tags.length > 0) {
          await this.addKeyToTags(key, tags);
        }
      }

      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Background revalidation completed',
        'CacheService',
        { key }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Background revalidation failed',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );

      // On error, keep the current cache valid longer to prevent stampedes
      await this.client.expire(key, cacheTtl);
    } finally {
      // Always clear the revalidation flag when done
      await this.del(revalidationKey);
    }
  }

  /**
   * Check if the Redis server is under high load.
   * Used for adaptive caching strategies.
   */
  private async isHighLoad(): Promise<boolean> {
    try {
      const info = await this.client.info('stats');

      // Extract operations per second
      const opsPerSecMatch = info.match(/instantaneous_ops_per_sec:(\d+)/);
      if (opsPerSecMatch) {
        const opsPerSec = parseInt(opsPerSecMatch[1] || '0', 10);
        // Consider high load if more than 1000 ops/sec
        return opsPerSec > 1000;
      }

      return false;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error checking Redis load',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      return false;
    }
  }

  /**
   * Store compressed data in Redis to save memory.
   * Used for large cache entries.
   */
  private async setCompressed<T>(key: string, value: T, ttl?: number): Promise<void> {
    const stringValue = JSON.stringify(value);

    // Only compress if data is large enough to benefit
    if (stringValue.length < 1024) {
      return this.set(key, stringValue, ttl);
    }

    try {
      // This would use a compression library in a real implementation
      // For now we'll just use a placeholder
      const compressed = Buffer.from(`compressed:${stringValue}`).toString('base64');

      await this.set(key, compressed, ttl);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error compressing data',
        'CacheService',
        {
          key,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      // Fall back to uncompressed storage
      await this.set(key, stringValue, ttl);
    }
  }

  /**
   * Retrieve and decompress data from Redis.
   */
  private getDecompressed<T>(data: string): T {
    if (!data.startsWith('compressed:')) {
      return JSON.parse(data) as T;
    }

    try {
      // This would decompress using the same library in a real implementation
      // For now we'll just use a placeholder
      const decompressed = Buffer.from(data, 'base64').toString();
      const jsonString = decompressed.substring('compressed:'.length);

      return JSON.parse(jsonString) as T;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error decompressing data',
        'CacheService',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      // Attempt to parse as if it wasn't compressed
      return JSON.parse(data) as T;
    }
  }

  /**
   * Standard cache method without SWR behavior.
   * Used when SWR is disabled but caching is still needed.
   *
   * @param key - Cache key
   * @param fetchFn - Function to fetch fresh data
   * @param cacheTtl - Cache time-to-live in seconds
   * @param forceRefresh - Whether to bypass cache and force fresh data
   * @returns Cached or fresh data
   * @private
   */
  private async standardCacheFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    cacheTtl: number,
    forceRefresh: boolean
  ): Promise<T> {
    // If force refresh, skip cache check
    if (forceRefresh) {
      const data = await fetchFn();
      if (data !== undefined && data !== null) {
        try {
          const serializedData = JSON.stringify(data);
          if (serializedData !== '[object Object]') {
            await this.set(key, serializedData, cacheTtl);
          } else {
            void this.loggingService.log(
              LogType.CACHE,
              LogLevel.WARN,
              'Skipping cache storage: data could not be serialized properly',
              'CacheService',
              { key }
            );
          }
        } catch (_error) {
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.WARN,
            'Failed to serialize data for caching',
            'CacheService',
            {
              key,
              error: _error instanceof Error ? _error.message : String(_error),
              stack: _error instanceof Error ? _error.stack : undefined,
            }
          );
        }
      }
      return data;
    }

    // Check cache first
    const cachedData = await this.get(key);
    if (cachedData) {
      await this.incrementCacheStats('hits');
      try {
        return JSON.parse(cachedData) as T;
      } catch (_error) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Failed to parse cached data',
          'CacheService',
          {
            key,
            error: _error instanceof Error ? _error.message : String(_error),
            stack: _error instanceof Error ? _error.stack : undefined,
          }
        );
        // Remove corrupted cache entry
        await this.del(key);
        // Fall through to fetch fresh data
      }
    }

    // Cache miss
    await this.incrementCacheStats('misses');
    const data = await fetchFn();

    // Store in cache
    if (data !== undefined && data !== null) {
      try {
        const serializedData = JSON.stringify(data);
        if (serializedData !== '[object Object]') {
          await this.set(key, serializedData, cacheTtl);
        } else {
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.WARN,
            'Skipping cache storage: data could not be serialized properly',
            'CacheService',
            { key }
          );
        }
      } catch (_error) {
        void this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Failed to serialize data for caching',
          'CacheService',
          {
            key,
            error: _error instanceof Error ? _error.message : String(_error),
            stack: _error instanceof Error ? _error.stack : undefined,
          }
        );
      }
    }

    return data;
  }
}
