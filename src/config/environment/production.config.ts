import type { ProductionConfig } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '@config/constants';
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
 * Validates required environment variables for production
 * Uses centralized validation utility for consistent error messages
 * @throws Error if required variables are missing
 */
function validateProductionConfig(): void {
  const result = validateEnvironmentConfig('production', false);

  if (!result.isValid) {
    const errorMessage = getEnvironmentValidationErrorMessage('production', result.missing);
    throw new Error(errorMessage);
  }
}

/**
 * Production environment configuration
 *
 * Production mode is optimized for production deployment with:
 * - Strict security settings
 * - Info/Warn logging (no debug)
 * - Production service defaults
 * - High performance settings
 * - Required environment variable validation
 *
 * @returns Production configuration object
 * @throws Error if required environment variables are missing
 */
export default function createProductionConfig(): ProductionConfig {
  // Validate required environment variables
  validateProductionConfig();
  return {
    app: {
      // Use helper functions (which use dotenv) for environment variable access
      port: parseInteger(getEnv(ENV_VARS.PORT), DEFAULT_CONFIG.PORT, 1, 65535),
      apiPrefix: getEnvWithDefault('API_PREFIX', DEFAULT_CONFIG.API_PREFIX),
      environment: 'production' as const,
      isDev: false,
      host: getEnvWithDefault(ENV_VARS.HOST, 'api.ishswami.in'),
      bindAddress: getEnvWithDefault(ENV_VARS.BIND_ADDRESS, '0.0.0.0'),
      // CRITICAL: baseUrl should NOT include trailing slashes for proper URL concatenation
      baseUrl: removeTrailingSlash(
        getEnvWithDefault(ENV_VARS.BASE_URL, '') ||
          getEnvWithDefault(ENV_VARS.API_URL, '') ||
          'https://api.ishswami.in'
      ),
      apiUrl: getEnvWithDefault(ENV_VARS.API_URL, 'https://api.ishswami.in'),
    },
    urls: {
      // Use helper functions (which use dotenv) for environment variable access
      swagger: getEnvWithDefault(ENV_VARS.SWAGGER_URL, '/docs'),
      bullBoard: getEnvWithDefault(ENV_VARS.BULL_BOARD_URL, '/queue-dashboard'),
      socket: getEnvWithDefault(ENV_VARS.SOCKET_URL, '/socket.io'),
      redisCommander: getEnvWithDefault(ENV_VARS.REDIS_COMMANDER_URL, ''),
      prismaStudio: getEnvWithDefault(ENV_VARS.PRISMA_STUDIO_URL, '/prisma'),
      frontend: getEnvWithDefault(ENV_VARS.FRONTEND_URL, 'https://ishswami.in'),
    },
    database: {
      // Use helper functions (which use dotenv) for environment variable access
      url:
        getEnvWithDefault('DATABASE_URL_PROD', '') ||
        getEnvWithDefault(ENV_VARS.DATABASE_URL, '') ||
        'postgresql://postgres:postgres@postgres:5432/userdb?connection_limit=50&pool_timeout=20',
      sqlInjectionPrevention: {
        enabled: getEnvBoolean('DB_SQL_INJECTION_PREVENTION', true),
      },
      rowLevelSecurity: {
        enabled: getEnvBoolean('DB_ROW_LEVEL_SECURITY', true),
      },
      dataMasking: {
        enabled: getEnvBoolean('DB_DATA_MASKING', true),
      },
      rateLimiting: {
        enabled: getEnvBoolean('DB_RATE_LIMITING', true),
      },
      readReplicas: {
        enabled: getEnvBoolean('DB_READ_REPLICAS_ENABLED', false),
        strategy: 'round-robin',
        urls: (() => {
          const urlsValue = getEnv('DB_READ_REPLICAS_URLS');
          return urlsValue ? urlsValue.split(',').filter(Boolean) : [];
        })(),
      },
    },
    redis: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.REDIS_HOST, 'redis'),
      port: parseInteger(getEnv(ENV_VARS.REDIS_PORT), 6379, 1, 65535),
      ttl: parseInteger(getEnv('REDIS_TTL'), DEFAULT_CONFIG.REDIS_TTL, 1),
      prefix: getEnvWithDefault('REDIS_PREFIX', 'healthcare:'),
      enabled: getEnvBoolean('REDIS_ENABLED', true),
      development: false,
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
        (getEnvWithDefault(ENV_VARS.LOG_LEVEL, 'info') as
          | 'error'
          | 'warn'
          | 'info'
          | 'debug'
          | 'verbose') || 'info',
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
      origin: getEnvWithDefault(
        ENV_VARS.CORS_ORIGIN,
        'https://ishswami.in,https://www.ishswami.in'
      ),
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
    domains: {
      // Use helper functions (which use dotenv) for environment variable access
      main: (() => {
        const url = getEnv(ENV_VARS.FRONTEND_URL);
        if (!url) return 'ishswami.in';
        const cleaned = url.replace(/^https?:\/\//, '');
        const parts = cleaned.split('/');
        return parts[0] || 'ishswami.in';
      })(),
      api: (() => {
        const url = getEnv(ENV_VARS.API_URL);
        if (!url) return 'api.ishswami.in';
        const cleaned = url.replace(/^https?:\/\//, '');
        const parts = cleaned.split('/');
        return parts[0] || 'api.ishswami.in';
      })(),
      frontend: (() => {
        const url = getEnv(ENV_VARS.FRONTEND_URL);
        if (!url) return 'ishswami.in';
        const cleaned = url.replace(/^https?:\/\//, '');
        const parts = cleaned.split('/');
        return parts[0] || 'ishswami.in';
      })(),
    },
  };
}
