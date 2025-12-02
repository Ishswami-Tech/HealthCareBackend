/**
 * Base Cache Client Service
 * @class BaseCacheClientService
 * @description Base class for Redis/Dragonfly cache services
 * Contains all common functionality shared between RedisService and DragonflyService
 */

import { Inject, forwardRef } from '@nestjs/common';
import { ConfigService, isCacheEnabled, getCacheProvider } from '@config';
import Redis from 'ioredis';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * Base class for cache client services (Redis/Dragonfly)
 * Provides common functionality for both providers
 */
export abstract class BaseCacheClientService {
  protected client!: Redis;
  protected readonly maxRetries = 5;
  protected readonly retryDelay = 5000; // 5 seconds
  protected readonly SECURITY_EVENT_RETENTION = 30 * 24 * 60 * 60; // 30 days
  protected readonly STATS_KEY = 'cache:stats';
  protected readonly isDevelopment: boolean;
  protected readonly verboseLoggingEnabled: boolean;

  // Circuit breaker state
  protected circuitBreakerOpen = false;
  protected circuitBreakerFailures = 0;
  protected readonly circuitBreakerThreshold = 10;
  protected readonly circuitBreakerResetTimeout = 60000; // 1 minute
  protected circuitBreakerLastFailureTime = 0;

  // Reconnection state
  protected isReconnecting = false;
  protected lastReconnectionAttempt = 0;
  protected readonly RECONNECTION_COOLDOWN = 5000; // 5 seconds

  // Production config (to be overridden by subclasses)
  protected abstract readonly PRODUCTION_CONFIG: {
    maxMemoryPolicy: string;
    maxConnections: number;
    connectionTimeout: number;
    commandTimeout: number;
    retryOnFailover: boolean;
    enableAutoPipelining: boolean;
    maxRetriesPerRequest: number;
    keyPrefix: string;
  };

  // Provider-specific config (to be overridden by subclasses)
  protected abstract readonly PROVIDER_NAME: 'redis' | 'dragonfly';
  protected abstract readonly DEFAULT_HOST: string;
  protected abstract readonly HOST_ENV_VAR: string;
  protected abstract readonly PORT_ENV_VAR: string;
  protected abstract readonly PASSWORD_ENV_VAR: string;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    protected readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    protected readonly loggingService: LoggingService
  ) {
    this.isDevelopment = this.isDevEnvironment();
    // Use ConfigService for verbose logging configuration
    this.verboseLoggingEnabled =
      this.configService?.getEnvBoolean('ENABLE_CACHE_DEBUG', false) ||
      this.configService?.getEnvBoolean('CACHE_VERBOSE_LOGS', false);
  }

  /**
   * Check if cache is enabled using single source of truth
   */
  protected shouldInitialize(): boolean {
    if (!isCacheEnabled()) {
      return false;
    }
    return getCacheProvider() === this.PROVIDER_NAME;
  }

  /**
   * Get provider-specific host
   * Uses ConfigService for Docker-aware host resolution
   */
  protected getHost(): string {
    // Use ConfigService if available (preferred method)
    if (this.configService) {
      if (this.PROVIDER_NAME === 'dragonfly') {
        return this.configService.getDragonflyHost();
      } else if (this.PROVIDER_NAME === 'redis') {
        return this.configService.getRedisHost();
      }
      // Fallback to generic cache host
      return this.configService.getCacheHost();
    }

    // Fallback to process.env if ConfigService not available (shouldn't happen in normal flow)
    const envHost = process.env[this.HOST_ENV_VAR];
    if (envHost) {
      return envHost;
    }

    // Check if we're in Docker/Kubernetes environment using ConfigService
    // ConfigService already has Docker detection logic, but if not available, use simple checks
    const isDocker =
      process.env['DOCKER_ENV'] === 'true' ||
      process.env['KUBERNETES_SERVICE_HOST'] !== undefined ||
      process.env['container'] !== undefined;

    // Use provider-specific default based on environment
    return isDocker ? this.DEFAULT_HOST : 'localhost';
  }

  /**
   * Get provider-specific port
   * Uses ConfigService for port resolution
   */
  protected getPort(): number {
    // Use ConfigService if available (preferred method)
    if (this.configService) {
      if (this.PROVIDER_NAME === 'dragonfly') {
        return this.configService.getDragonflyPort();
      } else if (this.PROVIDER_NAME === 'redis') {
        return this.configService.getRedisPort();
      }
      // Fallback to generic cache port
      return this.configService.getCachePort();
    }

    // Fallback to process.env if ConfigService not available
    return parseInt(process.env[this.PORT_ENV_VAR] || '6379', 10);
  }

  /**
   * Get provider-specific password
   * Uses ConfigService for password resolution
   */
  protected getPassword(): string | undefined {
    // Use ConfigService if available (preferred method)
    if (this.configService) {
      if (this.PROVIDER_NAME === 'dragonfly') {
        return this.configService.getDragonflyPassword();
      } else if (this.PROVIDER_NAME === 'redis') {
        return this.configService.getRedisPassword();
      }
      // Fallback to generic cache password
      return this.configService.getCachePassword();
    }

    // Fallback to process.env if ConfigService not available
      return process.env[this.PASSWORD_ENV_VAR] || undefined;
  }

  /**
   * Check if in development environment
   * Uses ConfigService for environment detection
   */
  protected isDevEnvironment(): boolean {
    // Use ConfigService if available (preferred method)
    if (this.configService) {
      return this.configService.isDevelopment();
    }

    // Fallback to process.env if ConfigService not available
    const nodeEnv = process.env['NODE_ENV'] || 'development';
    const isDev =
      nodeEnv === 'development' ||
      process.env['IS_DEV'] === 'true' ||
      process.env['IS_DEV'] === '1';
    return isDev;
  }

  /**
   * Initialize Redis client with common configuration
   */
  protected initializeClient(): void {
    try {
      if (!this.shouldInitialize()) {
        return;
      }

      const host = this.getHost();
      const port = this.getPort();
      const password = this.getPassword();
      const hasPassword = password && password.trim().length > 0;

      if (this.verboseLoggingEnabled) {
        void this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            `Initializing ${this.PROVIDER_NAME} connection to ${host}:${port}`,
            `${this.PROVIDER_NAME}Service`,
            { host, port, hasPassword: !!hasPassword }
          )
          .catch(() => {
            // Ignore logging errors
          });
      }

      const options: {
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
        host,
        port,
        ...(hasPassword && password && { password }),
        keyPrefix: this.PRODUCTION_CONFIG.keyPrefix,
        retryStrategy: times => {
          if (times > this.maxRetries) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'Max reconnection attempts reached',
              `${this.PROVIDER_NAME}Service`,
              { maxRetries: this.maxRetries }
            );
            return null;
          }
          return Math.min(this.retryDelay * times, 30000);
        },
        maxRetriesPerRequest: this.PRODUCTION_CONFIG.maxRetriesPerRequest,
        enableAutoPipelining: this.PRODUCTION_CONFIG.enableAutoPipelining,
        connectTimeout: this.PRODUCTION_CONFIG.connectionTimeout,
        commandTimeout: this.PRODUCTION_CONFIG.commandTimeout,
        enableReadyCheck: true,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4, // IPv4
      };

      // Use ConfigService to check if in production
      const isProduction = this.configService?.isProduction() ?? false;
      if (isProduction) {
        options.enableOfflineQueue = false;
      }

      this.client = new Redis(options);

      this.setupEventHandlers(host, port);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        error instanceof HealthcareError ? error.code : ErrorCode.CACHE_OPERATION_FAILED;
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to initialize ${this.PROVIDER_NAME} connection: ${errorMessage}`,
        `${this.PROVIDER_NAME}Service`,
        { error: errorMessage, code: errorCode }
      );
      throw error;
    }
  }

  /**
   * Setup Redis client event handlers
   */
  protected setupEventHandlers(host: string, port: number): void {
    this.client.on('error', err => {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `${this.PROVIDER_NAME} Client Error`,
        `${this.PROVIDER_NAME}Service`,
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
          `${this.PROVIDER_NAME} connected to ${host}:${port}`,
          `${this.PROVIDER_NAME}Service`,
          { host, port }
        );
      }
    });

    this.client.on('ready', () => {
      if (this.verboseLoggingEnabled) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `${this.PROVIDER_NAME} client ready`,
          `${this.PROVIDER_NAME}Service`,
          {}
        );
      }
    });
  }

  // ===== BASIC CACHE OPERATIONS (Common to both services) =====

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

  async del(key: string): Promise<number>;
  async del(...keys: string[]): Promise<number>;
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.del(...keys);
    } catch {
      return 0;
    }
  }

  async exists(key: string): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      return await this.client.exists(key);
    } catch {
      return 0;
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

  async ping(): Promise<string> {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error(`${this.PROVIDER_NAME} client not ready`);
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

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    if (!this.client || this.client.status !== 'ready') {
      return 'OK';
    }
    try {
      await this.client.ltrim(key, start, stop);
      return 'OK';
    } catch {
      return 'OK';
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

  async multi(
    commands: Array<{ command: string; args: unknown[] }>
  ): Promise<Array<[Error | null, unknown]>> {
    if (!this.client || this.client.status !== 'ready') {
      return commands.map(() => [new Error(`${this.PROVIDER_NAME} not ready`), null]);
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

  // ===== ADVANCED OPERATIONS =====

  async info(section?: string): Promise<string> {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error(`${this.PROVIDER_NAME} client not ready`);
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
      throw new Error(`${this.PROVIDER_NAME} client not ready`);
    }
    return this.client.pipeline();
  }

  duplicate(): Redis {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error(`${this.PROVIDER_NAME} client not ready`);
    }
    return this.client.duplicate();
  }

  getClient(): Redis | null {
    return this.client && this.client.status === 'ready' ? this.client : null;
  }
}
