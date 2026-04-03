import { Injectable } from '@nestjs/common';
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
  JitsiConfig,
  EnhancedRateLimitConfig,
  CacheConfig,
  VideoProviderConfig,
} from '@core/types/config.types';
import { getConfigValue } from './internal-config-store';
import {
  isCacheEnabled as checkCacheEnabled,
  getCacheProvider as getCacheProviderType,
} from './cache.config';
import {
  isVideoEnabled as checkVideoEnabled,
  getVideoProvider as getVideoProviderType,
} from './video.config';

@Injectable()
export class ConfigService {
  get<T = unknown>(path: string, defaultValue?: T): T {
    const value = getConfigValue<T>(path, defaultValue);
    if (value !== undefined) {
      return value;
    }

    throw new Error(`Configuration key "${path}" not found and no default provided`);
  }

  getAppConfig(): AppConfig {
    return this.get<AppConfig>('app');
  }

  getUrlsConfig(): UrlsConfig {
    return this.get<UrlsConfig>('urls');
  }

  getDatabaseConfig(): DatabaseConfig {
    return this.get<DatabaseConfig>('database');
  }

  getRedisConfig(): RedisConfig {
    return this.get<RedisConfig>('redis');
  }

  getJwtConfig(): JwtConfig {
    return this.get<JwtConfig>('jwt');
  }

  getPrismaConfig(): PrismaConfig {
    return this.get<PrismaConfig>('prisma');
  }

  getRateLimitConfig(): RateLimitConfig {
    const enhanced = this.get<EnhancedRateLimitConfig>('rateLimit');
    return {
      ttl: 60,
      max: enhanced.rules['api']?.limit || 100,
    };
  }

  getEnhancedRateLimitConfig(): EnhancedRateLimitConfig {
    return this.get<EnhancedRateLimitConfig>('rateLimit');
  }

  getLoggingConfig(): LoggingConfig {
    return this.get<LoggingConfig>('logging');
  }

  getEmailConfig(): EmailConfig {
    return this.get<EmailConfig>('email');
  }

  getCorsConfig(): CorsConfig {
    return this.get<CorsConfig>('cors');
  }

  getSecurityConfig(): SecurityConfig {
    return this.get<SecurityConfig>('security');
  }

  getWhatsappConfig(): WhatsappConfig {
    return this.get<WhatsappConfig>('whatsapp');
  }

  getJitsiConfig(): JitsiConfig {
    return this.get<JitsiConfig>('jitsi');
  }

  getVideoConfig(): VideoProviderConfig {
    return this.get<VideoProviderConfig>('video');
  }

  getCacheConfig(): CacheConfig {
    const config = this.get<CacheConfig>('cache');
    if (!config) {
      throw new Error('Cache configuration not found');
    }
    return config;
  }

  isCacheEnabled(): boolean {
    return checkCacheEnabled();
  }

  getCacheProvider(): 'redis' | 'dragonfly' | 'memory' {
    return getCacheProviderType();
  }

  isVideoEnabled(): boolean {
    return checkVideoEnabled();
  }

  getVideoProvider(): 'openvidu' | 'jitsi' {
    return getVideoProviderType();
  }

  getDragonflyHost(): string {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.host || 'dragonfly';
  }

  getDragonflyPort(): number {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.port || 6379;
  }

  getDragonflyPassword(): string | undefined {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.dragonfly?.password;
  }

  getRedisHost(): string {
    return this.getRedisConfig().host;
  }

  getRedisPort(): number {
    return this.getRedisConfig().port;
  }

  getRedisPassword(): string | undefined {
    const cacheConfig = this.getCacheConfig();
    return cacheConfig.redis?.password;
  }

  getCacheHost(): string {
    const provider = this.getCacheProvider();
    if (provider === 'dragonfly') {
      return this.getDragonflyHost();
    }
    if (provider === 'redis') {
      return this.getRedisHost();
    }
    return 'localhost';
  }

  getCachePort(): number {
    const provider = this.getCacheProvider();
    if (provider === 'dragonfly') {
      return this.getDragonflyPort();
    }
    if (provider === 'redis') {
      return this.getRedisPort();
    }
    return 6379;
  }

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
      jitsi: this.getJitsiConfig(),
      video: this.getVideoConfig(),
    };
  }

  isDevelopment(): boolean {
    return this.getAppConfig().isDev;
  }

  isProduction(): boolean {
    return this.getAppConfig().environment === 'production';
  }

  getEnvironment(): 'development' | 'production' | 'test' | 'staging' | 'local-prod' {
    return this.getAppConfig().environment;
  }

  getEnv(key: string, defaultValue?: string): string | undefined {
    return getConfigValue<string>(key, defaultValue);
  }

  getEnvNumber(key: string, defaultValue: number): number {
    const value = this.getEnv(key);
    if (!value) {
      return defaultValue;
    }

    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.getEnv(key);
    if (!value) {
      return defaultValue;
    }

    return value.toLowerCase() === 'true';
  }

  hasEnv(key: string): boolean {
    return this.getEnv(key) !== undefined;
  }
}
