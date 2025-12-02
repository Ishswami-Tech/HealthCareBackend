import { Injectable, Inject } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type {
  Config,
  AppConfig,
  UrlsConfig,
  DatabaseConfig,
  RedisConfig,
  JwtConfig,
  PrismaConfig,
  RateLimitConfig,
  LoggingConfig,
  EmailConfig,
  CorsConfig,
  SecurityConfig,
  WhatsappConfig,
  EnhancedRateLimitConfig,
  CacheConfig,
} from '@core/types';
import {
  isCacheEnabled as checkCacheEnabled,
  getCacheProvider as getCacheProviderType,
} from './cache.config';

/**
 * Enhanced Type-Safe Configuration Service
 *
 * Wraps NestJS ConfigService with:
 * - Full TypeScript type safety
 * - Typed getter methods for better IDE support
 * - Consistent API across the application
 * - Optimized for 10M+ users (singleton, zero overhead)
 *
 * @class ConfigService
 * @description Type-safe wrapper around NestJS ConfigService
 *
 * Performance Notes:
 * - Singleton pattern (NestJS default) - loaded once at startup
 * - No runtime file I/O - all config loaded in memory
 * - Minimal memory footprint - shared across all requests
 * - Type-safe access - compile-time validation prevents errors
 */
@Injectable()
export class ConfigService {
  constructor(
    @Inject(NestConfigService)
    private readonly nestConfigService: NestConfigService
  ) {}

  /**
   * Generic getter with type safety
   * @template T - Type of the configuration value
   * @param path - Configuration path (supports dot notation)
   * @param defaultValue - Optional default value if not found
   * @returns Configuration value or default
   */
  get<T = unknown>(path: string, defaultValue?: T): T {
    // CRITICAL: Check process.env FIRST before calling NestJS ConfigService
    // This ensures environment variables are always accessible even if not in config files
    const envValue = process.env[path];
    if (envValue !== undefined) {
      // Type assertion needed because process.env values are strings
      // Caller is responsible for proper type handling
      return envValue as T;
    }

    try {
      // Try to get from NestJS ConfigService (loads from .env files and config factories)
      if (defaultValue !== undefined) {
        const configValue = this.nestConfigService.get<T>(path, defaultValue);
        return configValue;
      }

      // Try to get value, but don't throw if not found
      try {
        const value = this.nestConfigService.get<T>(path);
        if (value !== undefined) {
          return value;
        }
      } catch {
        // NestJS ConfigService throws if key doesn't exist - that's OK, we'll use default
      }

      // If no value found and no default provided, throw error
      if (defaultValue === undefined) {
        throw new Error(`Configuration key "${path}" not found and no default provided`);
      }

      return defaultValue;
    } catch (error) {
      // If we have a default value, return it
      if (defaultValue !== undefined) {
        return defaultValue;
      }

      // Re-throw if no default provided
      throw error;
    }
  }

  /**
   * Get application configuration
   * @returns Application configuration
   */
  getAppConfig(): AppConfig {
    return this.get<AppConfig>('app');
  }

  /**
   * Get URLs configuration
   * @returns URLs configuration
   */
  getUrlsConfig(): UrlsConfig {
    return this.get<UrlsConfig>('urls');
  }

  /**
   * Get database configuration
   * @returns Database configuration
   */
  getDatabaseConfig(): DatabaseConfig {
    return this.get<DatabaseConfig>('database');
  }

  /**
   * Get Redis configuration
   * @returns Redis configuration
   */
  getRedisConfig(): RedisConfig {
    return this.get<RedisConfig>('redis');
  }

  /**
   * Get JWT configuration
   * @returns JWT configuration
   */
  getJwtConfig(): JwtConfig {
    return this.get<JwtConfig>('jwt');
  }

  /**
   * Get Prisma configuration
   * @returns Prisma configuration
   */
  getPrismaConfig(): PrismaConfig {
    return this.get<PrismaConfig>('prisma');
  }

  /**
   * Get rate limit configuration (basic)
   * @returns Rate limit configuration
   */
  getRateLimitConfig(): RateLimitConfig {
    const enhanced = this.get<EnhancedRateLimitConfig>('rateLimit');
    // Convert enhanced config to basic config
    return {
      ttl: 60, // Default TTL
      max: enhanced.rules['api']?.limit || 100, // Use API rule limit as default
    };
  }

  /**
   * Get enhanced rate limit configuration (with rules)
   * @returns Enhanced rate limit configuration
   */
  getEnhancedRateLimitConfig(): EnhancedRateLimitConfig {
    return this.get<EnhancedRateLimitConfig>('rateLimit');
  }

  /**
   * Get logging configuration
   * @returns Logging configuration
   */
  getLoggingConfig(): LoggingConfig {
    return this.get<LoggingConfig>('logging');
  }

  /**
   * Get email configuration
   * @returns Email configuration
   */
  getEmailConfig(): EmailConfig {
    return this.get<EmailConfig>('email');
  }

  /**
   * Get CORS configuration
   * @returns CORS configuration
   */
  getCorsConfig(): CorsConfig {
    return this.get<CorsConfig>('cors');
  }

  /**
   * Get security configuration
   * @returns Security configuration
   */
  getSecurityConfig(): SecurityConfig {
    return this.get<SecurityConfig>('security');
  }

  /**
   * Get WhatsApp configuration
   * @returns WhatsApp configuration
   */
  getWhatsappConfig(): WhatsappConfig {
    return this.get<WhatsappConfig>('whatsapp');
  }

  /**
   * Get cache configuration
   * @returns Cache configuration
   */
  getCacheConfig(): CacheConfig {
    const config = this.get<CacheConfig>('cache');
    if (!config) {
      throw new Error('Cache configuration not found');
    }
    return config;
  }

  /**
   * Check if cache is enabled
   * @returns True if cache is enabled
   */
  isCacheEnabled(): boolean {
    return checkCacheEnabled();
  }

  /**
   * Get cache provider type
   * @returns 'redis' | 'dragonfly' | 'memory'
   */
  getCacheProvider(): 'redis' | 'dragonfly' | 'memory' {
    return getCacheProviderType();
  }

  /**
   * Get Dragonfly host (with Docker-aware defaults)
   * @returns Dragonfly host
   */
  getDragonflyHost(): string {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.host || 'dragonfly';
  }

  /**
   * Get Dragonfly port
   * @returns Dragonfly port
   */
  getDragonflyPort(): number {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.port || 6379;
  }

  /**
   * Get Dragonfly password (if set)
   * @returns Dragonfly password or undefined
   */
  getDragonflyPassword(): string | undefined {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.password;
  }

  /**
   * Get Redis host (with Docker-aware defaults)
   * @returns Redis host
   */
  getRedisHost(): string {
    const redisConfig = this.getRedisConfig();
    return redisConfig.host;
  }

  /**
   * Get Redis port
   * @returns Redis port
   */
  getRedisPort(): number {
    const redisConfig = this.getRedisConfig();
    return redisConfig.port;
  }

  /**
   * Get Redis password (if set)
   * @returns Redis password or undefined
   */
  getRedisPassword(): string | undefined {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.redis?.password;
  }

  /**
   * Get cache host based on provider (Dragonfly or Redis)
   * @returns Cache host
   */
  getCacheHost(): string {
    const provider = this.getCacheProvider();
    if (provider === 'dragonfly') {
      return this.getDragonflyHost();
    }
    if (provider === 'redis') {
      return this.getRedisHost();
    }
    return 'localhost'; // memory provider
  }

  /**
   * Get cache port based on provider (Dragonfly or Redis)
   * @returns Cache port
   */
  getCachePort(): number {
    const provider = this.getCacheProvider();
    if (provider === 'dragonfly') {
      return this.getDragonflyPort();
    }
    if (provider === 'redis') {
      return this.getRedisPort();
    }
    return 6379; // default
  }

  /**
   * Get cache password based on provider (Dragonfly or Redis)
   * @returns Cache password or undefined
   */
  getCachePassword(): string | undefined {
    const provider = this.getCacheProvider();
    if (provider === 'dragonfly') {
      return this.getDragonflyPassword();
    }
    if (provider === 'redis') {
      return this.getRedisPassword();
    }
    return undefined;
  }

  /**
   * Get full configuration object
   * @returns Complete configuration
   */
  getConfig(): Config {
    return {
      app: this.getAppConfig(),
      urls: this.getUrlsConfig(),
      database: this.getDatabaseConfig(),
      redis: this.getRedisConfig(),
      jwt: this.getJwtConfig(),
      prisma: this.getPrismaConfig(),
      rateLimit: this.getRateLimitConfig(),
      logging: this.getLoggingConfig(),
      email: this.getEmailConfig(),
      cors: this.getCorsConfig(),
      security: this.getSecurityConfig(),
      whatsapp: this.getWhatsappConfig(),
    };
  }

  /**
   * Check if application is in development mode
   * @returns True if in development mode
   */
  isDevelopment(): boolean {
    return this.getAppConfig().isDev;
  }

  /**
   * Check if application is in production mode
   * @returns True if in production mode
   */
  isProduction(): boolean {
    return this.getAppConfig().environment === 'production';
  }

  /**
   * Get current environment
   * @returns Current environment
   */
  /**
   * Get current environment
   * @returns Current environment
   * @see https://docs.nestjs.com - For environment configuration patterns
   */
  getEnvironment(): 'development' | 'production' | 'test' | 'staging' {
    // The environment may include 'staging' as well, according to the config typing.
    // This ensures safe, type-correct handling for all supported environments.
    return this.getAppConfig().environment;
  }

  /**
   * Get environment variable directly (fallback for variables not in config)
   * Use this only when the variable is not part of the typed configuration
   * Prefer using typed getter methods (getAppConfig, getRedisConfig, etc.)
   * @param key - Environment variable name
   * @param defaultValue - Optional default value
   * @returns Environment variable value or default
   */
  getEnv(key: string, defaultValue?: string): string | undefined {
    // First try to get from NestJS ConfigService (supports dot notation)
    const configValue = this.nestConfigService.get<string>(key);
    if (configValue !== undefined) {
      return configValue;
    }

    // Fallback to process.env (for variables not in config files)
    const envValue = process.env[key];
    if (envValue !== undefined) {
      return envValue;
    }

    return defaultValue;
  }

  /**
   * Get environment variable as number
   * @param key - Environment variable name
   * @param defaultValue - Default value if not found or invalid
   * @returns Parsed number or default
   */
  getEnvNumber(key: string, defaultValue: number): number {
    const value = this.getEnv(key);
    if (!value) {
      return defaultValue;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Get environment variable as boolean
   * @param key - Environment variable name
   * @param defaultValue - Default value if not found
   * @returns Parsed boolean or default
   */
  getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.getEnv(key);
    if (!value) {
      return defaultValue;
    }

    return value.toLowerCase() === 'true';
  }

  /**
   * Check if environment variable exists
   * @param key - Environment variable name
   * @returns True if variable exists and has a value
   */
  hasEnv(key: string): boolean {
    return this.getEnv(key) !== undefined;
  }
}
