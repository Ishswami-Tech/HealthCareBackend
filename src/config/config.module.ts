import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';
import redisConfig from './redis.config';
import rateLimitConfig from './rate-limit.config';
import { healthcareConfig } from '@infrastructure/database/config/healthcare.config';
import { ConfigService } from './config.service';
import { ENV_VARS } from './constants';

/**
 * Enhanced Configuration Module for the Healthcare Application
 * 
 * Provides:
 * - Global configuration access throughout the application
 * - Type-safe configuration service wrapper
 * - Optimized for 10M+ users (singleton, zero overhead)
 * 
 * @module ConfigModule
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [
        process.env[ENV_VARS.NODE_ENV] === 'production' ? productionConfig : developmentConfig,
        redisConfig,
        rateLimitConfig,
        healthcareConfig,
      ],
      isGlobal: true,
      envFilePath: [`.env.${process.env[ENV_VARS.NODE_ENV] || 'development'}`, '.env'],
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
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
