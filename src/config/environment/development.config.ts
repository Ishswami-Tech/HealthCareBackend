import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '../constants';

/**
 * Parses integer from environment variable with validation
 * @param value - Environment variable value
 * @param defaultValue - Default value
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer
 */
function parseInteger(
  value: string | undefined,
  defaultValue: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const parsed = value ? parseInt(value, 10) : defaultValue;

  if (isNaN(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

/**
 * Parses boolean from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default boolean value
 * @returns Parsed boolean or default
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Development environment configuration
 * @returns Development configuration object
 */
export default function createDevelopmentConfig(): Config {
  return {
    app: {
      port: parseInteger(process.env[ENV_VARS.PORT], DEFAULT_CONFIG.PORT, 1, 65535),
      apiPrefix: process.env['API_PREFIX'] || DEFAULT_CONFIG.API_PREFIX,
      environment: 'development' as const,
      isDev: process.env['IS_DEV'] !== 'false',
      host: process.env['HOST'] || 'localhost',
      bindAddress: process.env['BIND_ADDRESS'] || '0.0.0.0',
      baseUrl:
        process.env['BASE_URL'] ||
        `http://localhost:${process.env[ENV_VARS.PORT] || DEFAULT_CONFIG.PORT}`,
      apiUrl:
        process.env['API_URL'] ||
        `http://localhost:${process.env[ENV_VARS.PORT] || DEFAULT_CONFIG.PORT}`,
    },
    urls: {
      swagger: process.env['SWAGGER_URL'] || '/docs',
      bullBoard: process.env['BULL_BOARD_URL'] || '/queue-dashboard',
      socket: process.env['SOCKET_URL'] || '/socket.io',
      redisCommander: process.env['REDIS_COMMANDER_URL'] || 'http://localhost:8082',
      prismaStudio: process.env['PRISMA_STUDIO_URL'] || 'http://localhost:5555',
      pgAdmin: process.env['PGADMIN_URL'] || 'http://localhost:5050',
      frontend: process.env['FRONTEND_URL'] || 'http://localhost:3000',
    },
    database: {
      url:
        process.env[ENV_VARS.DATABASE_URL] ||
        'postgresql://postgres:postgres@postgres:5432/userdb?schema=public',
      sqlInjectionPrevention: {
        enabled: parseBoolean(process.env['DB_SQL_INJECTION_PREVENTION'], false),
      },
      rowLevelSecurity: {
        enabled: parseBoolean(process.env['DB_ROW_LEVEL_SECURITY'], false),
      },
      dataMasking: {
        enabled: parseBoolean(process.env['DB_DATA_MASKING'], false),
      },
      rateLimiting: {
        enabled: parseBoolean(process.env['DB_RATE_LIMITING'], false),
      },
      readReplicas: {
        enabled: parseBoolean(process.env['DB_READ_REPLICAS_ENABLED'], false),
        strategy: 'random',
        urls: [],
      },
    },
    redis: {
      host: process.env[ENV_VARS.REDIS_HOST] || 'localhost',
      port: parseInteger(process.env[ENV_VARS.REDIS_PORT], 6379, 1, 65535),
      ttl: parseInteger(process.env['REDIS_TTL'], DEFAULT_CONFIG.REDIS_TTL, 1),
      prefix: process.env['REDIS_PREFIX'] || 'healthcare:',
      enabled: parseBoolean(process.env['REDIS_ENABLED'], true),
      development: true,
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
        'debug',
      enableAuditLogs: parseBoolean(process.env['ENABLE_AUDIT_LOGS'], true),
    },
    email: {
      host: process.env[ENV_VARS.EMAIL_HOST] || 'sandbox.smtp.mailtrap.io',
      port: parseInteger(process.env[ENV_VARS.EMAIL_PORT], 2525, 1, 65535),
      secure: parseBoolean(process.env['EMAIL_SECURE'], false),
      user: process.env[ENV_VARS.EMAIL_USER] || '',
      password: process.env[ENV_VARS.EMAIL_PASSWORD] || '',
      from: process.env['EMAIL_FROM'] || 'noreply@healthcare.com',
    },
    cors: {
      origin:
        process.env[ENV_VARS.CORS_ORIGIN] ||
        'http://localhost:8088,http://localhost:5050,http://localhost:8082',
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
