import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '@config/constants';
import {
  parseInteger,
  removeTrailingSlash,
  getDefaultRedisHost,
  getEnvWithDefault,
  getEnvBoolean,
  getEnv,
} from './utils';
import createJitsiConfig from '../jitsi.config';
import { videoConfig } from '../video.config';

/**
 * Development environment configuration
 *
 * Development mode is optimized for local development with:
 * - Hot-reload enabled
 * - Debug logging
 * - Lenient security (for faster development)
 * - Local service defaults (localhost)
 * - Development tools enabled (Swagger, Prisma Studio)
 *
 * @returns Development configuration object
 */
export default function createDevelopmentConfig(): Config {
  return {
    app: {
      // Use helper functions (which use dotenv) for environment variable access
      port: parseInteger(getEnv(ENV_VARS.PORT), DEFAULT_CONFIG.PORT, 1, 65535),
      apiPrefix: getEnvWithDefault(ENV_VARS.API_PREFIX, DEFAULT_CONFIG.API_PREFIX),
      environment: 'development' as const,
      isDev: getEnvBoolean(ENV_VARS.IS_DEV, true),
      host: getEnvWithDefault(ENV_VARS.HOST, 'localhost'),
      bindAddress: getEnvWithDefault(ENV_VARS.BIND_ADDRESS, '0.0.0.0'),
      // CRITICAL: baseUrl and apiUrl should NOT include trailing slashes for proper URL concatenation
      // The swagger URL uses ${baseUrl}${swagger} pattern, so baseUrl must not end with /
      baseUrl: removeTrailingSlash(
        getEnvWithDefault(ENV_VARS.BASE_URL, '') ||
          getEnvWithDefault(ENV_VARS.API_URL, '') ||
          `http://localhost:${getEnv(ENV_VARS.PORT) || DEFAULT_CONFIG.PORT}`
      ),
      apiUrl: removeTrailingSlash(
        getEnvWithDefault(ENV_VARS.API_URL, '') ||
          `http://localhost:${getEnv(ENV_VARS.PORT) || DEFAULT_CONFIG.PORT}`
      ),
    },
    urls: {
      // Use helper functions (which use dotenv) for environment variable access
      swagger: getEnvWithDefault(ENV_VARS.SWAGGER_URL, '/docs'),
      bullBoard: getEnvWithDefault(ENV_VARS.BULL_BOARD_URL, '/queue-dashboard'),
      socket: getEnvWithDefault(ENV_VARS.SOCKET_URL, '/socket.io'),
      redisCommander: getEnvWithDefault(ENV_VARS.REDIS_COMMANDER_URL, 'http://localhost:8082'),
      prismaStudio: getEnvWithDefault(ENV_VARS.PRISMA_STUDIO_URL, 'http://localhost:5555'),
      frontend: getEnvWithDefault(ENV_VARS.FRONTEND_URL, 'http://localhost:3000'),
    },
    database: {
      // Use helper functions (which use dotenv) for environment variable access
      url:
        getEnvWithDefault(ENV_VARS.DATABASE_URL, '') ||
        'postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=50&pool_timeout=20',
      sqlInjectionPrevention: {
        enabled: getEnvBoolean('DB_SQL_INJECTION_PREVENTION', false),
      },
      rowLevelSecurity: {
        enabled: getEnvBoolean('DB_ROW_LEVEL_SECURITY', false),
      },
      dataMasking: {
        enabled: getEnvBoolean('DB_DATA_MASKING', false),
      },
      rateLimiting: {
        enabled: getEnvBoolean('DB_RATE_LIMITING', false),
      },
      readReplicas: {
        enabled: getEnvBoolean('DB_READ_REPLICAS_ENABLED', false),
        strategy: 'random',
        urls: [],
      },
    },
    redis: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.REDIS_HOST, getDefaultRedisHost()),
      port: parseInteger(getEnv(ENV_VARS.REDIS_PORT), 6379, 1, 65535),
      ttl: parseInteger(getEnv('REDIS_TTL'), DEFAULT_CONFIG.REDIS_TTL, 1),
      prefix: getEnvWithDefault('REDIS_PREFIX', 'healthcare:'),
      enabled: getEnvBoolean('REDIS_ENABLED', true),
      development: true,
    },
    jwt: {
      // Use helper functions (which use dotenv) for environment variable access
      secret: getEnvWithDefault(ENV_VARS.JWT_SECRET, 'your-super-secret-key-change-in-production'),
      expiration: getEnvWithDefault(ENV_VARS.JWT_EXPIRATION, DEFAULT_CONFIG.JWT_EXPIRATION),
    },
    prisma: {
      // Use helper functions (which use dotenv) for environment variable access
      schemaPath: getEnvWithDefault(
        'PRISMA_SCHEMA_PATH',
        './src/libs/infrastructure/database/prisma/schema.prisma'
      ),
    },
    rateLimit: {
      // Use helper functions (which use dotenv) for environment variable access
      ttl: parseInteger(getEnv('RATE_LIMIT_TTL'), DEFAULT_CONFIG.RATE_LIMIT_TTL, 1),
      max: parseInteger(getEnv('RATE_LIMIT_MAX'), DEFAULT_CONFIG.RATE_LIMIT_MAX, 1),
    },
    logging: {
      // Use helper functions (which use dotenv) for environment variable access
      level:
        (getEnvWithDefault(ENV_VARS.LOG_LEVEL, 'debug') as
          | 'error'
          | 'warn'
          | 'info'
          | 'debug'
          | 'verbose') || 'debug',
      enableAuditLogs: getEnvBoolean('ENABLE_AUDIT_LOGS', true),
    },
    email: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.EMAIL_HOST, 'sandbox.smtp.mailtrap.io'),
      port: parseInteger(getEnv(ENV_VARS.EMAIL_PORT), 2525, 1, 65535),
      secure: getEnvBoolean('EMAIL_SECURE', false),
      user: getEnvWithDefault(ENV_VARS.EMAIL_USER, ''),
      password: getEnvWithDefault(ENV_VARS.EMAIL_PASSWORD, ''),
      from: getEnvWithDefault('EMAIL_FROM', 'noreply@healthcare.com'),
    },
    cors: {
      // Use helper functions (which use dotenv) for environment variable access
      origin:
        getEnvWithDefault(ENV_VARS.CORS_ORIGIN, '') ||
        'http://localhost:8088,http://localhost:8082',
      credentials: getEnvBoolean('CORS_CREDENTIALS', true),
      methods: getEnvWithDefault('CORS_METHODS', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'),
    },
    security: {
      // Use helper functions (which use dotenv) for environment variable access
      rateLimit: getEnvBoolean('SECURITY_RATE_LIMIT', true),
      rateLimitMax: parseInteger(getEnv('SECURITY_RATE_LIMIT_MAX'), 1000, 1),
      rateLimitWindowMs: parseInteger(getEnv('SECURITY_RATE_LIMIT_WINDOW_MS'), 15000, 1000),
      trustProxy: parseInteger(getEnv('TRUST_PROXY'), 1, 0, 2),
    },
    whatsapp: {
      // Use helper functions (which use dotenv) for environment variable access
      enabled: getEnvBoolean(ENV_VARS.WHATSAPP_ENABLED, false),
      apiUrl: getEnvWithDefault('WHATSAPP_API_URL', 'https://graph.facebook.com/v25.0'),
      apiKey: getEnvWithDefault(ENV_VARS.WHATSAPP_API_KEY, ''),
      phoneNumberId: getEnvWithDefault('WHATSAPP_PHONE_NUMBER_ID', ''),
      businessAccountId: getEnvWithDefault('WHATSAPP_BUSINESS_ACCOUNT_ID', ''),
      otpTemplateId: getEnvWithDefault('WHATSAPP_OTP_TEMPLATE_ID', 'otp_verification'),
      appointmentTemplateId: getEnvWithDefault(
        'WHATSAPP_APPOINTMENT_TEMPLATE_ID',
        'appointment_reminder'
      ),
      prescriptionTemplateId: getEnvWithDefault(
        'WHATSAPP_PRESCRIPTION_TEMPLATE_ID',
        'prescription_notification'
      ),
    },
    jitsi: createJitsiConfig(),
    video: videoConfig(),
  };
}
