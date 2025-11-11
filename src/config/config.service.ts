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
} from '@core/types';

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
    try {
      if (defaultValue !== undefined) {
        return this.nestConfigService.get<T>(path, defaultValue);
      }
      const value = this.nestConfigService.get<T>(path);
      if (value !== undefined) {
        return value;
      }
      // Fallback to process.env for robustness
      const envValue = process.env[path];
      if (envValue !== undefined) {
        return envValue as T;
      }
      throw new Error(`Configuration key "${path}" not found and no default provided`);
    } catch (_error) {
      // Fallback to process.env for robustness
      const envValue = process.env[path];
      if (envValue !== undefined) {
        return envValue as T;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Configuration key "${path}" not found and no default provided`);
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
  getEnvironment(): 'development' | 'production' | 'test' {
    return this.getAppConfig().environment;
  }
}
