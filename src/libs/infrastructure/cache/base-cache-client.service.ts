/**
 * Base Cache Client Service
 * @class BaseCacheClientService
 * @description Base class for Redis/Dragonfly cache services
 * Contains all common functionality shared between RedisService and DragonflyService
 */

import { Inject, forwardRef } from '@nestjs/common';
// IMPORTANT: avoid importing from the @config barrel in infra boot code.
// SWC/CommonJS can expose circular import TDZ issues via barrel exports.
import { ConfigService } from '@config/config.service';
import { isCacheEnabled, getCacheProvider } from '@config/cache.config';
import Redis from 'ioredis';
import { LogType, LogLevel } from '@core/types';
import type { LoggerLike } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

import {
  DELETE_BATCH_SIZE,
  deleteKeysByPattern,
  emptyPatternDeleteResult,
  listKeysByPattern,
} from './utils/pattern-delete.util';
import type { PatternDeleteOptions, PatternDeleteResult } from './utils/pattern-delete.util';

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
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE')
    protected readonly loggingService: LoggerLike
  ) {
    this.isDevelopment = this.isDevEnvironment();
    // Use ConfigService for verbose logging configuration (required, so always available)
    this.verboseLoggingEnabled =
      this.configService.getEnvBoolean('ENABLE_CACHE_DEBUG', false) ||
      this.configService.getEnvBoolean('CACHE_VERBOSE_LOGS', false);
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
    // Use ConfigService (required, so always available)
    if (this.PROVIDER_NAME === 'dragonfly') {
      return this.configService.getDragonflyHost();
    } else if (this.PROVIDER_NAME === 'redis') {
      return this.configService.getRedisHost();
    }
    // Fallback to generic cache host
    return this.configService.getCacheHost();
  }

  /**
   * Get provider-specific port
   * Uses ConfigService for port resolution
   */
  protected getPort(): number {
    // Use ConfigService (required, so always available)
    if (this.PROVIDER_NAME === 'dragonfly') {
      return this.configService.getDragonflyPort();
    } else if (this.PROVIDER_NAME === 'redis') {
      return this.configService.getRedisPort();
    }
    // Fallback to generic cache port
    return this.configService.getCachePort();
  }

  /**
   * Get provider-specific password
   * Uses ConfigService for password resolution
   */
  protected getPassword(): string | undefined {
    // Use ConfigService (required, so always available)
    if (this.PROVIDER_NAME === 'dragonfly') {
      return this.configService.getDragonflyPassword();
    } else if (this.PROVIDER_NAME === 'redis') {
      return this.configService.getRedisPassword();
    }
    // Fallback to generic cache password
    return this.configService.getCachePassword();
  }

  /**
   * Check if in development environment
   * Uses ConfigService for environment detection
   */
  protected isDevEnvironment(): boolean {
    // Use ConfigService (required, so always available)
    return this.configService.isDevelopment() || this.configService.getEnvBoolean('IS_DEV', false);
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

      // Use ConfigService to check if in production (required, so always available)
      const isProduction = this.configService.isProduction();
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
      // Same silent no-op as set() below: a value that was written
      // successfully moments earlier (confirmed present and correctly
      // shaped via direct inspection) still gets treated as a cache miss on
      // the very next read whenever the client isn't 'ready' at that exact
      // instant - indistinguishable from "never cached" to every caller,
      // which is why the dashboard-summary composition kept re-running on
      // nearly every request even after its write started succeeding.
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `[BaseCacheClientService] get() skipped for key "${key}": client ${!this.client ? 'missing' : `not ready (status=${this.client.status})`}`,
        'BaseCacheClientService.get',
        { key, clientStatus: this.client?.status ?? 'no-client' }
      );
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `[BaseCacheClientService] get() threw for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
        'BaseCacheClientService.get',
        { key, error: error instanceof Error ? error.stack : String(error) }
      );
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client || this.client.status !== 'ready') {
      // This guard - not any of the several exception handlers upstream - was
      // the actual reason a write could vanish with zero signal: no client,
      // or a client mid-reconnect, makes this a silent no-op before any
      // command is even attempted. Every caller up the stack (BaseCacheStrategy,
      // CacheService, PHICacheStrategy, DragonflyCacheProvider/RedisService)
      // was already fixed to log on a thrown error, but none of them can see
      // a call that returns successfully without ever trying.
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `[BaseCacheClientService] set() skipped for key "${key}": client ${!this.client ? 'missing' : `not ready (status=${this.client.status})`}`,
        'BaseCacheClientService.set',
        { key, clientStatus: this.client?.status ?? 'no-client' }
      );
      return;
    }
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `[BaseCacheClientService] set() threw for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
        'BaseCacheClientService.set',
        { key, error: error instanceof Error ? error.stack : String(error) }
      );
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

  async acquireLock(key: string, ttlSeconds: number, value: string = '1'): Promise<boolean> {
    if (!this.client || this.client.status !== 'ready') {
      return false;
    }
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return false;
    }
  }

  async releaseLock(key: string): Promise<boolean> {
    return (await this.del(key)) > 0;
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

  /**
   * Keys matching `pattern`, as LOGICAL names (without the connection `keyPrefix`), so they can be
   * passed straight back to get/lRange/del. ioredis does not apply `keyPrefix` to a KEYS/SCAN
   * glob and returns raw names, which used to make `keys('queue:*')` miss every key and return
   * names that were double-prefixed when handed back. Walks the keyspace with SCAN.
   *
   * A failure is logged at ERROR and reported as no keys (this is a lookup, callers treat "no
   * keys" as an empty result), never silently.
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.client || this.client.status !== 'ready') {
      return [];
    }
    try {
      return await listKeysByPattern(this.client, this.PRODUCTION_CONFIG.keyPrefix, pattern);
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.ERROR,
        `[BaseCacheClientService] keys() failed for pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
        `${this.PROVIDER_NAME}Service.keys`,
        { pattern, error: error instanceof Error ? error.stack : String(error) }
      );
      return [];
    }
  }

  async ping(): Promise<string> {
    if (!this.client) {
      throw new Error(`${this.PROVIDER_NAME} client not initialized`);
    }
    // If client exists but isn't ready, attempt reconnection before failing
    if (this.client.status !== 'ready') {
      try {
        await this.client.connect();
      } catch {
        // Reconnection failed — fall through to throw below
      }
    }
    if (this.client.status !== 'ready') {
      throw new Error(`${this.PROVIDER_NAME} client not ready (status: ${this.client.status})`);
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

  /**
   * Deletes every key matching `pattern` (a glob over the logical, unprefixed key names) and
   * reports what happened instead of throwing. See pattern-delete.util.ts for the key prefix
   * handling, the SCAN walk, the batching and the protected-namespace deny-list.
   *
   * Logging contract: a refused pattern, skipped protected keys and an unavailable client are
   * WARN; a failed delete is ERROR. Nothing is swallowed silently.
   */
  async clearCacheDetailed(
    pattern: string,
    options: PatternDeleteOptions = {}
  ): Promise<PatternDeleteResult> {
    if (!this.client || this.client.status !== 'ready') {
      this.logPatternDeleteIssue(LogLevel.WARN, 'Pattern delete skipped: cache client not ready', {
        pattern,
        clientStatus: this.client?.status ?? 'no-client',
      });
      return emptyPatternDeleteResult(pattern, { unavailable: true });
    }

    const result = await deleteKeysByPattern(
      this.client,
      this.PRODUCTION_CONFIG.keyPrefix,
      pattern,
      options
    );
    if (result.refused) {
      this.logPatternDeleteIssue(
        LogLevel.WARN,
        'Pattern delete refused: pattern targets a protected cache namespace',
        { pattern }
      );
    } else if (result.protectedSkipped > 0) {
      this.logPatternDeleteIssue(
        LogLevel.WARN,
        'Pattern delete skipped keys in protected cache namespaces',
        { pattern, protectedSkipped: result.protectedSkipped, deleted: result.deleted }
      );
    }
    if (result.error) {
      this.logPatternDeleteIssue(LogLevel.ERROR, 'Pattern delete failed', {
        pattern,
        error: result.error,
        deletedBeforeFailure: result.deleted,
      });
    }
    return result;
  }

  /**
   * Numeric form of {@link clearCacheDetailed}: returns the number of keys deleted and THROWS when
   * the delete failed, so a failure can never be mistaken for "nothing matched". An unavailable
   * client or a refused pattern deletes nothing and returns 0 (both are already logged).
   */
  async clearCache(pattern: string, options: PatternDeleteOptions = {}): Promise<number> {
    const result = await this.clearCacheDetailed(pattern, options);
    if (result.error) {
      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        `Failed to delete cache keys matching "${pattern}"`,
        undefined,
        { pattern, error: result.error, deleted: result.deleted },
        `${this.PROVIDER_NAME}Service.clearCache`
      );
    }
    return result.deleted;
  }

  /**
   * Deletes exact keys in bounded batches and THROWS if any batch fails or the client is not
   * ready. For callers (tag invalidation) that must know whether the delete really happened
   * before they discard their only index of those keys.
   */
  async deleteKeysStrict(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) return 0;
    if (!this.client || this.client.status !== 'ready') {
      throw new HealthcareError(
        ErrorCode.CACHE_CONNECTION_FAILED,
        `${this.PROVIDER_NAME} client not ready`,
        undefined,
        { keys: keys.length },
        `${this.PROVIDER_NAME}Service.deleteKeysStrict`
      );
    }
    let deleted = 0;
    for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
      deleted +=
        typeof this.client.unlink === 'function'
          ? await this.client.unlink(...batch)
          : await this.client.del(...batch);
    }
    return deleted;
  }

  /**
   * Raises a key's TTL to at least `seconds` and NEVER shortens it. `EXPIRE ... NX` gives a key
   * without a TTL its first one, `EXPIRE ... GT` only ever extends. A server that rejects the
   * options falls back to read-then-extend.
   *
   * Used for tag-index sets, which are shared by many entries with different TTLs: the last
   * entry registered must not decide how long the set (and therefore the invalidation path of
   * every older, longer-lived entry) lives.
   */
  async extendExpiry(key: string, seconds: number): Promise<number> {
    if (!this.client || this.client.status !== 'ready') {
      return 0;
    }
    try {
      await this.client.expire(key, seconds, 'NX');
      return await this.client.expire(key, seconds, 'GT');
    } catch {
      const current = await this.client.ttl(key);
      if (current === -2) return 0;
      return current === -1 || current < seconds ? await this.client.expire(key, seconds) : 0;
    }
  }

  private logPatternDeleteIssue(
    level: LogLevel,
    message: string,
    details: Record<string, string | number>
  ): void {
    void this.loggingService.log(
      LogType.CACHE,
      level,
      message,
      `${this.PROVIDER_NAME}Service.clearCache`,
      details
    );
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
