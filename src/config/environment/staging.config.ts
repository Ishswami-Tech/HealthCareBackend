import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '../constants';
import { parseInteger, parseBoolean, removeTrailingSlash } from './utils';
import { validateEnvironmentConfig, getEnvironmentValidationErrorMessage } from './validation';

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
      port: parseInteger(process.env[ENV_VARS.PORT], DEFAULT_CONFIG.PORT, 1, 65535),
      apiPrefix: process.env['API_PREFIX'] || DEFAULT_CONFIG.API_PREFIX,
      environment: 'production' as const, // Use production type for staging (same security level)
      isDev: false, // Not development mode
      host: process.env['HOST'] || 'staging-api.ishswami.in',
      bindAddress: process.env['BIND_ADDRESS'] || '0.0.0.0',
      baseUrl: removeTrailingSlash(
        process.env['BASE_URL'] || process.env['API_URL'] || 'http://staging-api.ishswami.in'
      ),
      apiUrl: process.env['API_URL'] || 'http://staging-api.ishswami.in',
    },
    urls: {
      swagger: process.env['SWAGGER_URL'] || '/docs',
      bullBoard: process.env['BULL_BOARD_URL'] || '/queue-dashboard',
      socket: process.env['SOCKET_URL'] || '/socket.io',
      redisCommander: process.env['REDIS_COMMANDER_URL'] || 'http://localhost:8082',
      prismaStudio: process.env['PRISMA_STUDIO_URL'] || '/prisma',
      pgAdmin: process.env['PGADMIN_URL'] || 'http://localhost:5050',
      frontend: process.env['FRONTEND_URL'] || 'http://staging.ishswami.in',
    },
    database: {
      url:
        process.env['DATABASE_URL_STAGING'] ||
        process.env[ENV_VARS.DATABASE_URL] ||
        'postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=50&pool_timeout=20',
      sqlInjectionPrevention: {
        enabled: parseBoolean(process.env['DB_SQL_INJECTION_PREVENTION'], true), // Production-like security
      },
      rowLevelSecurity: {
        enabled: parseBoolean(process.env['DB_ROW_LEVEL_SECURITY'], true), // Production-like security
      },
      dataMasking: {
        enabled: parseBoolean(process.env['DB_DATA_MASKING'], true), // Production-like security
      },
      rateLimiting: {
        enabled: parseBoolean(process.env['DB_RATE_LIMITING'], true), // Production-like security
      },
      readReplicas: {
        enabled: parseBoolean(process.env['DB_READ_REPLICAS_ENABLED'], false),
        strategy: 'round-robin',
        urls: process.env['DB_READ_REPLICAS_URLS']
          ? process.env['DB_READ_REPLICAS_URLS'].split(',')
          : [],
      },
    },
    redis: {
      host: process.env[ENV_VARS.REDIS_HOST] || 'redis',
      port: parseInteger(process.env[ENV_VARS.REDIS_PORT], 6379, 1, 65535),
      ttl: parseInteger(process.env['REDIS_TTL'], DEFAULT_CONFIG.REDIS_TTL, 1),
      prefix: process.env['REDIS_PREFIX'] || 'healthcare:staging:',
      enabled: parseBoolean(process.env['REDIS_ENABLED'], true),
      development: false, // Not development mode
    },
    jwt: {
      secret: process.env[ENV_VARS.JWT_SECRET] || 'your-super-secret-key-change-in-production',
      expiration: process.env[ENV_VARS.JWT_EXPIRATION] || DEFAULT_CONFIG.JWT_EXPIRATION,
    },
    prisma: {
      schemaPath:
        process.env['PRISMA_SCHEMA_PATH'] ||
        './src/libs/infrastructure/database/prisma/schema.prisma',
    },
    rateLimit: {
      ttl: parseInteger(process.env['RATE_LIMIT_TTL'], DEFAULT_CONFIG.RATE_LIMIT_TTL, 1),
      max: parseInteger(process.env['RATE_LIMIT_MAX'], DEFAULT_CONFIG.RATE_LIMIT_MAX, 1),
    },
    logging: {
      level:
        (process.env[ENV_VARS.LOG_LEVEL] as 'error' | 'warn' | 'info' | 'debug' | 'verbose') ||
        'debug', // Debug logging for staging (for testing)
      enableAuditLogs: parseBoolean(process.env['ENABLE_AUDIT_LOGS'], true),
    },
    email: {
      host: process.env[ENV_VARS.EMAIL_HOST] || 'sandbox.smtp.mailtrap.io',
      port: parseInteger(process.env[ENV_VARS.EMAIL_PORT], 2525, 1, 65535),
      secure: parseBoolean(process.env['EMAIL_SECURE'], false),
      user: process.env[ENV_VARS.EMAIL_USER] || '',
      password: process.env[ENV_VARS.EMAIL_PASSWORD] || '',
      from: process.env['EMAIL_FROM'] || 'noreply@healthcare-staging.com',
    },
    cors: {
      origin:
        process.env[ENV_VARS.CORS_ORIGIN] ||
        'http://staging.ishswami.in,http://staging-api.ishswami.in,http://localhost:3000',
      credentials: parseBoolean(process.env['CORS_CREDENTIALS'], true),
      methods: process.env['CORS_METHODS'] || 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    },
    security: {
      rateLimit: parseBoolean(process.env['SECURITY_RATE_LIMIT'], true),
      rateLimitMax: parseInteger(process.env['SECURITY_RATE_LIMIT_MAX'], 1000, 1),
      rateLimitWindowMs: parseInteger(process.env['SECURITY_RATE_LIMIT_WINDOW_MS'], 15000, 1000),
      trustProxy: parseInteger(process.env['TRUST_PROXY'], 1, 0, 2),
    },
    whatsapp: {
      enabled: parseBoolean(process.env[ENV_VARS.WHATSAPP_ENABLED], false),
      apiUrl: process.env['WHATSAPP_API_URL'] || 'https://graph.facebook.com/v17.0',
      apiKey: process.env[ENV_VARS.WHATSAPP_API_KEY] || '',
      phoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] || '',
      businessAccountId: process.env['WHATSAPP_BUSINESS_ACCOUNT_ID'] || '',
      otpTemplateId: process.env['WHATSAPP_OTP_TEMPLATE_ID'] || 'otp_verification',
      appointmentTemplateId:
        process.env['WHATSAPP_APPOINTMENT_TEMPLATE_ID'] || 'appointment_reminder',
      prescriptionTemplateId:
        process.env['WHATSAPP_PRESCRIPTION_TEMPLATE_ID'] || 'prescription_notification',
    },
  };
}
