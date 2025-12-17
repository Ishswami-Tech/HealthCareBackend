import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as path from 'path';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';
import stagingConfig from './environment/staging.config';
import testConfig from './environment/test.config';
import cacheConfig, { redisConfig } from './cache.config';
import rateLimitConfig from './rate-limit.config';
import jitsiConfig from './jitsi.config';
import videoConfig from './video.config';
import { healthcareConfig } from '@infrastructure/database/config/healthcare.config';
import { ConfigService } from './config.service';
import { PaymentConfigService } from './payment-config.service';
import { ENV_VARS } from './constants';
// CommunicationConfigModule is imported lazily by PaymentConfigService using forwardRef to avoid circular dependency
import {
  validateEnvironmentConfig,
  getEnvironmentValidationErrorMessage,
} from './environment/validation';

/**
 * Load environment variables using dotenv with proper priority
 * Priority: .env.local > .env.{NODE_ENV} > .env
 * This ensures local overrides work correctly
 */
function loadEnvironmentVariables(): void {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';
  const rootPath = process.cwd();

  // Load in priority order (later files override earlier ones)
  // 1. Base .env file (lowest priority)
  dotenv.config({ path: path.join(rootPath, '.env') });

  // 2. Environment-specific .env file
  dotenv.config({ path: path.join(rootPath, `.env.${nodeEnv}`) });

  // 3. Local overrides (highest priority, only if exists)
  dotenv.config({ path: path.join(rootPath, '.env.local'), override: true });
}

// Load environment variables before NestJS ConfigModule initializes
// This ensures all environment variables are available when config factories run
loadEnvironmentVariables();

/**
 * Get the appropriate config factory based on NODE_ENV
 * Supports: development, production, staging, test
 *
 * @returns Config factory function
 */
function getConfigFactory() {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';

  switch (nodeEnv) {
    case 'production':
      return productionConfig;
    case 'staging':
      return stagingConfig;
    case 'test':
      return testConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}

/**
 * Validate environment configuration early
 * This provides better error messages before the app starts
 */
function validateConfigEarly(): void {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';

  try {
    const result = validateEnvironmentConfig(nodeEnv, false); // Don't throw yet

    if (!result.isValid) {
      // Log warnings for missing recommended vars
      if (result.warnings.length > 0 && nodeEnv !== 'test') {
        console.warn(
          `⚠️  Recommended environment variables not set for ${nodeEnv}: ${result.warnings.join(', ')}`
        );
      }

      // Only throw for production/staging (strict environments)
      if ((nodeEnv === 'production' || nodeEnv === 'staging') && result.missing.length > 0) {
        const errorMessage = getEnvironmentValidationErrorMessage(nodeEnv, result.missing);
        throw new Error(errorMessage);
      }
    }
  } catch (error) {
    // Re-throw validation errors
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown configuration validation error');
  }
}

// Validate configuration early (before NestJS initializes)
validateConfigEarly();

/**
 * Enhanced Configuration Module for the Healthcare Application
 *
 * Provides:
 * - Global configuration access throughout the application
 * - Type-safe configuration service wrapper
 * - Optimized for 10M+ users (singleton, zero overhead)
 * - Centralized dotenv configuration with proper file priority
 *
 * Environment File Priority:
 * 1. .env.local (highest priority - local overrides)
 * 2. .env.{NODE_ENV} (environment-specific, e.g., .env.development)
 * 3. .env (base configuration, lowest priority)
 *
 * @module ConfigModule
 */
@Global()
@Module({
  imports: [
    // CommunicationConfigModule is imported lazily by PaymentConfigService using forwardRef to avoid circular dependency
    // ConfigModule -> CommunicationConfigModule -> ConfigModule cycle is broken by lazy injection
    NestConfigModule.forRoot({
      load: [
        getConfigFactory(), // Get appropriate config based on NODE_ENV
        cacheConfig, // Single source of truth for cache configuration
        redisConfig,
        rateLimitConfig,
        jitsiConfig, // Jitsi Meet configuration (for backward compatibility)
        videoConfig, // Video provider configuration (OpenVidu primary, Jitsi fallback)
        healthcareConfig,
      ],
      isGlobal: true,
      // NestJS ConfigModule will also load .env files, but we've already loaded them above
      // This ensures compatibility and proper variable resolution
      envFilePath: [
        '.env.local', // Highest priority
        `.env.${process.env[ENV_VARS.NODE_ENV] || 'development'}`, // Environment-specific
        '.env', // Base file
      ],
      // Expand variables in .env files (e.g., ${VAR})
      expandVariables: true,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
  providers: [ConfigService, PaymentConfigService],
  exports: [ConfigService, PaymentConfigService],
})
export class ConfigModule {
  /**
   * Validates configuration on module initialization
   */
  static forRoot(): typeof ConfigModule {
    // Configuration validation will be performed by the individual config factories
    return ConfigModule;
  }
}
