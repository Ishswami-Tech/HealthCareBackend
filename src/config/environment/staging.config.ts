import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '../constants';
import {
  parseInteger,
  removeTrailingSlash,
  getEnvWithDefault,
  getEnvBoolean,
  getEnv,
} from './utils';
import { validateEnvironmentConfig, getEnvironmentValidationErrorMessage } from './validation';
import createJitsiConfig from '../jitsi.config';
import { videoConfig } from '../video.config';

/**
 * Validates required environment variables for staging
 * Staging requires same variables as production but with more lenient error handling
 * Uses centralized validation utility for consistent error messages
 * @throws Error if required variables are missing
 */
function validateStagingConfig(): void {
  const result = validateEnvironmentConfig('staging', false);

  if (!result.isValid) {
    const errorMessage = getEnvironmentValidationErrorMessage('staging', result.missing);
    throw new Error(errorMessage);
  }
}

/**
 * Staging environment configuration
 *
 * Staging is a production-like environment for testing before production deployment.
 * It uses production-like security settings but with debug logging enabled for troubleshooting.
 *
 * Key differences from production:
 * - Debug logging enabled (for testing and troubleshooting)
 * - More lenient error messages
 * - Can use test/staging database
 * - Swagger may be enabled for API testing
 *
 * @returns Staging configuration object
 */
export default function createStagingConfig(): Config {
  // Validate required environment variables
  validateStagingConfig();

  return {
    app: {
      // Use helper functions (which use dotenv) for environment variable access
      port: parseInteger(getEnv(ENV_VARS.PORT), DEFAULT_CONFIG.PORT, 1, 65535),
      apiPrefix: getEnvWithDefault('API_PREFIX', DEFAULT_CONFIG.API_PREFIX),
      environment: 'production' as const, // Use production type for staging (same security level)
      isDev: false, // Not development mode
      host: getEnvWithDefault(ENV_VARS.HOST, 'staging-api.ishswami.in'),
      bindAddress: getEnvWithDefault(ENV_VARS.BIND_ADDRESS, '0.0.0.0'),
      baseUrl: removeTrailingSlash(
        getEnvWithDefault(ENV_VARS.BASE_URL, '') ||
          getEnvWithDefault(ENV_VARS.API_URL, '') ||
          'http://staging-api.ishswami.in'
      ),
      apiUrl: getEnvWithDefault(ENV_VARS.API_URL, 'http://staging-api.ishswami.in'),
    },
    urls: {
      // Use helper functions (which use dotenv) for environment variable access
      swagger: getEnvWithDefault(ENV_VARS.SWAGGER_URL, '/docs'),
      bullBoard: getEnvWithDefault(ENV_VARS.BULL_BOARD_URL, '/queue-dashboard'),
      socket: getEnvWithDefault(ENV_VARS.SOCKET_URL, '/socket.io'),
      redisCommander: getEnvWithDefault(ENV_VARS.REDIS_COMMANDER_URL, 'http://localhost:8082'),
      prismaStudio: getEnvWithDefault(ENV_VARS.PRISMA_STUDIO_URL, '/prisma'),
      pgAdmin: getEnvWithDefault(ENV_VARS.PGADMIN_URL, 'http://localhost:5050'),
      frontend: getEnvWithDefault(ENV_VARS.FRONTEND_URL, 'http://staging.ishswami.in'),
    },
    database: {
      // Use helper functions (which use dotenv) for environment variable access
      url:
        getEnvWithDefault('DATABASE_URL_STAGING', '') ||
        getEnvWithDefault(ENV_VARS.DATABASE_URL, '') ||
        'postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=50&pool_timeout=20',
      sqlInjectionPrevention: {
        enabled: getEnvBoolean('DB_SQL_INJECTION_PREVENTION', true), // Production-like security
      },
      rowLevelSecurity: {
        enabled: getEnvBoolean('DB_ROW_LEVEL_SECURITY', true), // Production-like security
      },
      dataMasking: {
        enabled: getEnvBoolean('DB_DATA_MASKING', true), // Production-like security
      },
      rateLimiting: {
        enabled: getEnvBoolean('DB_RATE_LIMITING', true), // Production-like security
      },
      readReplicas: {
        enabled: getEnvBoolean('DB_READ_REPLICAS_ENABLED', false),
        strategy: 'round-robin',
        urls: getEnv('DB_READ_REPLICAS_URLS')
          ? getEnv('DB_READ_REPLICAS_URLS')!.split(',').filter(Boolean)
          : [],
      },
    },
    redis: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.REDIS_HOST, 'redis'),
      port: parseInteger(getEnv(ENV_VARS.REDIS_PORT), 6379, 1, 65535),
      ttl: parseInteger(getEnv('REDIS_TTL'), DEFAULT_CONFIG.REDIS_TTL, 1),
      prefix: getEnvWithDefault('REDIS_PREFIX', 'healthcare:staging:'),
      enabled: getEnvBoolean('REDIS_ENABLED', true),
      development: false, // Not development mode
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
          | 'verbose') || 'debug', // Debug logging for staging (for testing)
      enableAuditLogs: getEnvBoolean('ENABLE_AUDIT_LOGS', true),
    },
    email: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.EMAIL_HOST, 'sandbox.smtp.mailtrap.io'),
      port: parseInteger(getEnv(ENV_VARS.EMAIL_PORT), 2525, 1, 65535),
      secure: getEnvBoolean('EMAIL_SECURE', false),
      user: getEnvWithDefault(ENV_VARS.EMAIL_USER, ''),
      password: getEnvWithDefault(ENV_VARS.EMAIL_PASSWORD, ''),
      from: getEnvWithDefault('EMAIL_FROM', 'noreply@healthcare-staging.com'),
    },
    cors: {
      // Use helper functions (which use dotenv) for environment variable access
      origin:
        getEnvWithDefault(ENV_VARS.CORS_ORIGIN, '') ||
        'http://staging.ishswami.in,http://staging-api.ishswami.in,http://localhost:3000',
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
      apiUrl: getEnvWithDefault('WHATSAPP_API_URL', 'https://graph.facebook.com/v17.0'),
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
