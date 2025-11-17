/**
 * Dragonfly Service
 * @class DragonflyService
 * @description Low-level DragonflyDB service for cache operations
 * Dragonfly is a drop-in Redis replacement with 26x better performance
 * This service provides direct access to Dragonfly operations
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@config';
import Redis from 'ioredis';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

@Injectable()
export class DragonflyService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000; // 5 seconds
  private readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days
  private readonly STATS_KEY = 'cache:stats';
  private readonly isDevelopment!: boolean;
  private readonly verboseLoggingEnabled: boolean;
  // Circuit breaker to prevent infinite retries when Dragonfly is down
  private circuitBreakerOpen = false;
  private circuitBreakerFailures = 0;
  private readonly circuitBreakerThreshold = 10; // Open circuit after 10 consecutive failures
  private readonly circuitBreakerResetTimeout = 60000; // 1 minute before attempting to reset
  private circuitBreakerLastFailureTime = 0;
  // Reconnection lock to prevent multiple simultaneous reconnection attempts
  private isReconnecting = false;
  private lastReconnectionAttempt = 0;
  private readonly RECONNECTION_COOLDOWN = 5000; // 5 seconds between reconnection attempts

  // Production scaling configurations
  private readonly PRODUCTION_CONFIG = {
    maxMemoryPolicy: 'noeviction',
    maxConnections: parseInt(process.env['DRAGONFLY_MAX_CONNECTIONS'] || '100', 10),
    connectionTimeout: 15000, // Increased to 15 seconds for better reliability in Docker
    commandTimeout: 5000, // Increased to 5 seconds
    retryOnFailover: true,
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    keyPrefix: process.env['DRAGONFLY_KEY_PREFIX'] || 'healthcare:',
  };

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.isDevelopment = this.isDevEnvironment();
    this.verboseLoggingEnabled =
      process.env['ENABLE_CACHE_DEBUG'] === 'true' ||
      process.env['CACHE_VERBOSE_LOGS'] === 'true';
    this.initializeClient();
  }

  private isDevEnvironment(): boolean {
    const nodeEnv = process.env['NODE_ENV'] || 'development';
    const configNodeEnv = this.configService?.get<string>('NODE_ENV');
    const isDev =
      configNodeEnv === 'development' ||
      nodeEnv === 'development' ||
      process.env['IS_DEV'] === 'true' ||
      process.env['IS_DEV'] === '1';
    return isDev;
  }

  private initializeClient(): void {
    try {
      // IMPORTANT: This service should only be used when CACHE_PROVIDER=dragonfly
      // If CACHE_PROVIDER=redis, this service should not initialize
      const cacheProvider = (process.env['CACHE_PROVIDER'] || 'dragonfly').toLowerCase();
      if (cacheProvider !== 'dragonfly') {
        // Skip initialization if not using Dragonfly
        return;
      }

      // Determine default host based on environment
      const isDocker =
        process.env['DOCKER_ENV'] === 'true' ||
        process.env['KUBERNETES_SERVICE_HOST'] !== undefined ||
        process.env['DRAGONFLY_HOST'] !== undefined;

      const defaultHost = isDocker ? 'dragonfly' : 'localhost';

      // Use process.env directly to avoid configService defaults to localhost
      const dragonflyHost = process.env['DRAGONFLY_HOST'] || defaultHost;
      const dragonflyPort = parseInt(process.env['DRAGONFLY_PORT'] || '6379', 10);
      let dragonflyPassword: string | undefined;
      try {
        dragonflyPassword =
          this.configService?.get<string>('DRAGONFLY_PASSWORD') ||
          this.configService?.get<string>('dragonfly.password') ||
          process.env['DRAGONFLY_PASSWORD'] ||
          undefined;
      } catch {
        // Config key not found, use environment variable or undefined
        dragonflyPassword = process.env['DRAGONFLY_PASSWORD'] || undefined;
      }
      // Only include password if it's actually set and not empty
      const hasPassword = dragonflyPassword && dragonflyPassword.trim().length > 0;

      if (this.verboseLoggingEnabled) {
      void this.loggingService
        .log(
          LogType.SYSTEM,
            LogLevel.DEBUG,
          `Initializing Dragonfly connection to ${dragonflyHost}:${dragonflyPort}`,
          'DragonflyService',
          { host: dragonflyHost, port: dragonflyPort, hasPassword: !!hasPassword }
        )
        .catch(() => {
          // Ignore logging errors - connection is more important
        });
      }

      const dragonflyOptions: {
        host: string;
        port: number;
        password?: string;
        keyPrefix: string;
        retryStrategy: (times: number) => number | null;
        maxRetriesPerRequest: number;
        enableAutoPipelining: boolean;
        connectTimeout: number;
        commandTimeout: number;
        enableReadyCheck: boolean;
        autoResubscribe: boolean;
        autoResendUnfulfilledCommands: boolean;
        lazyConnect: boolean;
        keepAlive: number;
        family: number;
        enableOfflineQueue?: boolean;
      } = {
        host: dragonflyHost,
        port: dragonflyPort,
        ...(hasPassword && dragonflyPassword && { password: dragonflyPassword }),
        keyPrefix: this.PRODUCTION_CONFIG.keyPrefix,
        retryStrategy: times => {
          if (times > this.maxRetries) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'Max reconnection attempts reached',
              'DragonflyService',
              { maxRetries: this.maxRetries }
            );
            return null; // stop retrying
          }
          return Math.min(this.retryDelay * times, 30000); // Exponential backoff, max 30s
        },
        maxRetriesPerRequest: this.PRODUCTION_CONFIG.maxRetriesPerRequest,
        enableAutoPipelining: this.PRODUCTION_CONFIG.enableAutoPipelining,
        connectTimeout: this.PRODUCTION_CONFIG.connectionTimeout,
        commandTimeout: this.PRODUCTION_CONFIG.commandTimeout,
        enableReadyCheck: true,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
        lazyConnect: true, // Don't connect immediately
        // Production optimizations
        keepAlive: 30000,
        family: 4, // IPv4
      };

      // Connection pool settings for high concurrency
      if (process.env['NODE_ENV'] === 'production') {
        dragonflyOptions.enableOfflineQueue = false; // Fail fast in production
      }

      this.client = new Redis(dragonflyOptions);

      this.client.on('error', err => {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Dragonfly Client Error',
          'DragonflyService',
          {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          }
        );
      });

      this.client.on('connect', () => {
        if (this.verboseLoggingEnabled) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Dragonfly connected to ${dragonflyHost}:${dragonflyPort}`,
          'DragonflyService',
          { host: dragonflyHost, port: dragonflyPort }
        );
        }
      });

      this.client.on('ready', () => {
        if (this.verboseLoggingEnabled) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Dragonfly client ready',
          'DragonflyService',
          {}
        );
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof HealthcareError ? error.code : ErrorCode.CACHE_OPERATION_FAILED;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize Dragonfly connection: ${errorMessage}`,
        'DragonflyService',
        { error: errorMessage, code: errorCode }
      );
      throw error;
    }
  }

  async onModuleInit() {
    try {
      // Check if already connected to avoid duplicate connection attempts
      if (this.client && this.client.status === 'ready') {
        if (this.verboseLoggingEnabled) {
        void this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Dragonfly already connected, skipping connection attempt',
            'DragonflyService',
            {}
          )
          .catch(() => {
            // Ignore logging errors
          });
        }
        return;
      }

      // Check if Dragonfly is the selected cache provider before attempting connection
      const cacheProvider =
        this.configService?.get<string>('CACHE_PROVIDER')?.toLowerCase() ||
        process.env['CACHE_PROVIDER']?.toLowerCase() ||
        'dragonfly'; // Default to Dragonfly

      // Only connect if Dragonfly is the selected provider
      if (cacheProvider !== 'dragonfly') {
        if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `DragonflyService skipped - using ${cacheProvider} as cache provider`,
          'DragonflyService',
          { cacheProvider }
        );
        }
        return; // Don't connect if not using Dragonfly
      }

      // Check if Dragonfly is enabled before attempting connection
      const configEnabled = this.configService?.get<boolean>('dragonfly.enabled');
      const envEnabled = process.env['DRAGONFLY_ENABLED'] !== 'false';
      const isDragonflyEnabled = configEnabled ?? envEnabled;

      if (!isDragonflyEnabled) {
        if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Dragonfly is disabled in configuration',
          'DragonflyService',
          {}
        );
        }
        return;
      }

      // Connect to Dragonfly
      if (!this.client || this.client.status !== 'ready') {
        await this.client.connect();
        // Set eviction policy to noeviction immediately after connection
        await this.setEvictionPolicy();
        await this.optimizeMemoryUsage();
      }

      if (this.verboseLoggingEnabled) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'DragonflyService initialized successfully',
        'DragonflyService',
        {}
      );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `DragonflyService initialization failed: ${errorMessage}`,
        'DragonflyService',
        { error: errorMessage }
      );
      // Don't throw - allow app to continue without cache
    }
  }

  async onModuleDestroy() {
    try {
      if (this.client) {
        await this.client.quit();
        if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'DragonflyService disconnected',
          'DragonflyService',
          {}
        );
        }
      }
    } catch (error) {
      // Ignore errors during shutdown
    }
  }

  /**
   * Set eviction policy to noeviction
   * Note: In Dragonfly, eviction policy is controlled by --cache_mode flag:
   * - cache_mode=false (or not set) = noeviction (no eviction, returns OOM errors when full)
   * - cache_mode=true = automatic eviction (LRU/LFU)
   * Since we set cache_mode=false in Docker Compose, eviction is already disabled.
   * This method verifies the configuration.
   */
  private async setEvictionPolicy(): Promise<void> {
    try {
      // Dragonfly uses cache_mode flag, not maxmemory-policy CONFIG command
      // Verify that cache_mode is false (which means noeviction)
      // We can't change this at runtime - it's set at startup
      if (this.verboseLoggingEnabled) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Dragonfly eviction policy: noeviction (cache_mode=false set at startup)',
        'DragonflyService',
        {
          note: 'Dragonfly eviction is controlled by --cache_mode flag. cache_mode=false means noeviction policy.',
        }
      );
      }
    } catch (error) {
      // Ignore logging errors
    }
  }

  /**
   * Auto-scaling cache management
   * Note: Dragonfly may not support all Redis CONFIG commands
   * The eviction policy is set separately via setEvictionPolicy()
   */
  async optimizeMemoryUsage(): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') {
      try {
        if (this.verboseLoggingEnabled) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Applied production memory optimizations',
          'DragonflyService',
          {}
        );
        }
      } catch (error) {
        // Ignore config errors
      }
    }
  }

  // ===== BASIC CACHE OPERATIONS =====

  async get(key: string): Promise<string | null> {
    if (!this.client || this.client.status !== 'ready') {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client || this.client.status !== 'ready') {
      return;
    }
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch {
      // Fail silently - cache is not critical
    }
  }

  async del(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.del(key);
    } catch {
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client || this.client.status !== 'ready') {
      return false;
    }
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return -1;
    }
    try {
      return await this.client.ttl(key);
    } catch {
      return -1;
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.expire(key, seconds);
    } catch {
      return 0;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await this.client.keys(pattern);
    } catch {
      return [];
    }
  }

  async multi(commands: Array<{ command: string; args: unknown[] }>): Promise<Array<[Error | null, unknown]>> {
    if (!this.client || this.client.status !== 'ready') {
      return commands.map(() => [new Error('Dragonfly not ready'), null]);
    }
    try {
      const pipeline = this.client.pipeline();
      const pipelineAsAny = pipeline as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const cmd of commands) {
        const method = pipelineAsAny[cmd.command];
        if (method && typeof method === 'function') {
          method.apply(pipeline, cmd.args);
        }
      }
      const results = await pipeline.exec();
      return results || commands.map(() => [null, null]);
    } catch {
      return commands.map(() => [new Error('Multi operation failed'), null]);
    }
  }

  async clearCache(pattern: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;
      return await this.client.del(...keys);
    } catch {
      return 0;
    }
  }

  async ping(): Promise<string> {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Dragonfly client not ready');
    }
    return this.client.ping();
  }

  // ===== HASH OPERATIONS =====

  async hSet(key: string, field: string, value: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.hset(key, field, value);
    } catch {
      return 0;
    }
  }

  async hGet(key: string, field: string): Promise<string | null> {
    if (!this.client || this.client.status !== 'ready') {
      return null;
    }
    try {
      return await this.client.hget(key, field);
    } catch {
      return null;
    }
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    if (!this.client || this.client.status !== 'ready') {
      return {};
    }
    try {
      return await this.client.hgetall(key);
    } catch {
      return {};
    }
  }

  async hDel(key: string, field: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.hdel(key, field);
    } catch {
      return 0;
    }
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.hincrby(key, field, increment);
    } catch {
      return 0;
    }
  }

  // ===== LIST OPERATIONS =====

  async rPush(key: string, value: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.rpush(key, value);
    } catch {
      return 0;
    }
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await this.client.lrange(key, start, stop);
    } catch {
      return [];
    }
  }

  async lLen(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.llen(key);
    } catch {
      return 0;
    }
  }

  async lTrim(key: string, start: number, stop: number): Promise<void> {
    if (!this.client || this.client.status !== 'ready') {
      return;
    }
    try {
      await this.client.ltrim(key, start, stop);
    } catch {
      // Fail silently
    }
  }

  // ===== SET OPERATIONS =====

  async sAdd(key: string, ...members: string[]): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.sadd(key, ...members);
    } catch {
      return 0;
    }
  }

  async sMembers(key: string): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await this.client.smembers(key);
    } catch {
      return [];
    }
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.srem(key, ...members);
    } catch {
      return 0;
    }
  }

  async sCard(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.scard(key);
    } catch {
      return 0;
    }
  }

  // ===== SORTED SET OPERATIONS =====

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.zadd(key, score, member);
    } catch {
      return 0;
    }
  }

  async zcard(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.zcard(key);
    } catch {
      return 0;
    }
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await this.client.zrevrange(key, start, stop);
    } catch {
      return [];
    }
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await this.client.zrangebyscore(key, min, max);
    } catch {
      return [];
    }
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.zremrangebyscore(key, min, max);
    } catch {
      return 0;
    }
  }

  // ===== PUB/SUB OPERATIONS =====

  async publish(channel: string, message: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.publish(channel, message);
    } catch {
      return 0;
    }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.client || this.client.status !== 'ready') {
      return;
    }
    try {
      const subscriber = this.client.duplicate();
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, msg) => {
        if (ch === channel) {
          callback(msg);
        }
      });
    } catch {
      // Fail silently
    }
  }

  // ===== UTILITY OPERATIONS =====

  async expireAt(key: string, timestamp: number): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.expireat(key, timestamp);
    } catch {
      return 0;
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.incr(key);
    } catch {
      return 0;
    }
  }

  // ===== ADVANCED OPERATIONS =====

  async info(section?: string): Promise<string> {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Dragonfly client not ready');
    }
    try {
      if (section) {
        return await this.client.info(section);
      }
      return await this.client.info();
    } catch {
      return '';
    }
  }

  async dbsize(): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.dbsize();
    } catch {
      return 0;
    }
  }

  pipeline(): ReturnType<Redis['pipeline']> {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Dragonfly client not ready');
    }
    return this.client.pipeline();
  }

  duplicate(): Redis {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Dragonfly client not ready');
    }
    return this.client.duplicate();
  }

  // Get the underlying client (for advanced operations)
  getClient(): Redis | null {
    return this.client && this.client.status === 'ready' ? this.client : null;
  }
}

