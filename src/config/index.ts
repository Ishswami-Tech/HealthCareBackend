/**
 * Configuration Module Exports
 * @module Config
 * @description Centralized exports for configuration module
 *
 * This is the SINGLE SOURCE OF TRUTH for all configuration in the application.
 * All environment variables should be accessed through ConfigService.
 *
 * Environment File Loading Priority:
 * 1. .env.local (highest priority - local overrides, not committed to git)
 * 2. .env.{NODE_ENV} (environment-specific, e.g., .env.development, .env.production)
 * 3. .env (base configuration, lowest priority)
 *
 * Usage:
 * ```typescript
 * import { ConfigService } from '@config';
 *
 * constructor(private readonly config: ConfigService) {}
 *
 * // Typed configuration (preferred)
 * const appConfig = this.config.getAppConfig();
 * const redisConfig = this.config.getRedisConfig();
 * const cacheConfig = this.config.getCacheConfig();
 *
 * // Direct environment variable access (for variables not in typed config)
 * const customVar = this.config.getEnv('CUSTOM_VAR', 'default');
 * const port = this.config.getEnvNumber('CUSTOM_PORT', 3000);
 * const enabled = this.config.getEnvBoolean('CUSTOM_ENABLED', false);
 * ```
 *
 * Note: All configuration types are available from @core/types
 * Import types directly: import type { Config, AppConfig, ... } from '@core/types'
 */

/**
 * Configuration Module Exports
 * @module Config
 * @description Centralized exports for configuration module
 *
 * NOTE (SWC):
 * If you see a TDZ error involving this barrel, it means there is a circular import chain.
 * The correct fix is to break the cycle by importing from specific modules
 * (e.g. `@config/config.service`, `@config/cache.config`) in early-boot infrastructure code.
 */

export { ConfigModule } from './config.module';
export { ConfigService } from './config.service';
export { PaymentConfigService } from './payment-config.service';
export * from './constants';
export { isCacheEnabled, getCacheProvider, CacheConfigUtils } from './cache.config';
export { isVideoEnabled, getVideoProvider, VideoConfigUtils } from './video.config';
