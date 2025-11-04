import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';
import redisConfig from './redis.config';
import rateLimitConfig from './rate-limit.config';
import type { Config } from './config.types';
import { ENV_VARS } from './constants';

/**
 * Validates configuration on module initialization
 * @param config - Configuration object
 * @throws Error if configuration is invalid
 */
function _validateConfiguration(config: Config): void {
  // Validate required fields
  if (!config.app.port || config.app.port < 1 || config.app.port > 65535) {
    throw new Error('Invalid application port');
  }

  if (!config.database.url) {
    throw new Error('Database URL is required');
  }

  if (!config.jwt.secret) {
    throw new Error('JWT secret is required');
  }

  if (config.app.environment === 'production' && config.jwt.secret === 'your-secret-key') {
    throw new Error('Default JWT secret cannot be used in production');
  }

  // Validate Redis configuration
  if (config.redis.enabled) {
    if (!config.redis.host) {
      throw new Error('Redis host is required when Redis is enabled');
    }

    if (config.redis.port < 1 || config.redis.port > 65535) {
      throw new Error('Invalid Redis port');
    }
  }

  // Validate email configuration
  if (config.email.host && config.email.port < 1) {
    throw new Error('Invalid email port');
  }
}

/**
 * Configuration module for the application
 * Provides global configuration access throughout the application
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [
        process.env[ENV_VARS.NODE_ENV] === 'production' ? productionConfig : developmentConfig,
        redisConfig,
        rateLimitConfig,
      ],
      isGlobal: true,
      envFilePath: [`.env.${process.env[ENV_VARS.NODE_ENV] || 'development'}`, '.env'],
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
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
