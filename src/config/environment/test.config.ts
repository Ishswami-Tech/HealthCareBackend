import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '@config/constants';
import { parseInteger, getEnvWithDefault, getEnvBoolean, getEnv } from './utils';
import createJitsiConfig from '@config/jitsi.config';
import { videoConfig } from '@config/video.config';

/**
 * Test environment configuration
 *
 * Test environment is optimized for running unit and integration tests.
 * It uses minimal security settings, in-memory or test databases, and fast execution.
 *
 * Key characteristics:
 * - Minimal security (for faster test execution)
 * - Can use in-memory database or test database
 * - Debug logging enabled
 * - No external service dependencies (can be mocked)
 * - Fast execution (no heavy processing)
 *
 * @returns Test configuration object
 */
export default function createTestConfig(): Config {
  // Test environment doesn't require strict validation
  // Tests should be able to run with minimal configuration

  return {
    app: {
      // Use helper functions (which use dotenv) for environment variable access
      port: parseInteger(getEnv(ENV_VARS.PORT), 0, 0, 65535), // Port 0 = random port for tests
      apiPrefix: getEnvWithDefault('API_PREFIX', DEFAULT_CONFIG.API_PREFIX),
      environment: 'test' as const,
      isDev: true, // Test mode is like development
      host: getEnvWithDefault('HOST', 'localhost'),
      bindAddress: getEnvWithDefault('BIND_ADDRESS', '127.0.0.1'),
      baseUrl: getEnvWithDefault('BASE_URL', 'http://localhost:0'),
      apiUrl: getEnvWithDefault('API_URL', 'http://localhost:0'),
    },
    urls: {
      // Use helper functions (which use dotenv) for environment variable access
      swagger: getEnvWithDefault('SWAGGER_URL', '/docs'),
      bullBoard: getEnvWithDefault('BULL_BOARD_URL', '/queue-dashboard'),
      socket: getEnvWithDefault('SOCKET_URL', '/socket.io'),
      redisCommander: getEnvWithDefault('REDIS_COMMANDER_URL', 'http://localhost:8082'),
      prismaStudio: getEnvWithDefault('PRISMA_STUDIO_URL', 'http://localhost:5555'),
      frontend: getEnvWithDefault('FRONTEND_URL', 'http://localhost:3000'),
    },
    database: {
      // Use helper functions (which use dotenv) for environment variable access
      url:
        getEnvWithDefault(ENV_VARS.DATABASE_URL, '') ||
        getEnvWithDefault('TEST_DATABASE_URL', '') ||
        'postgresql://postgres:postgres@localhost:5432/test_userdb?connection_limit=50&pool_timeout=20',
      sqlInjectionPrevention: {
        enabled: getEnvBoolean('DB_SQL_INJECTION_PREVENTION', false), // Disabled for tests
      },
      rowLevelSecurity: {
        enabled: getEnvBoolean('DB_ROW_LEVEL_SECURITY', false), // Disabled for tests
      },
      dataMasking: {
        enabled: getEnvBoolean('DB_DATA_MASKING', false), // Disabled for tests
      },
      rateLimiting: {
        enabled: getEnvBoolean('DB_RATE_LIMITING', false), // Disabled for tests
      },
      readReplicas: {
        enabled: false, // No read replicas in tests
        strategy: 'random',
        urls: [],
      },
    },
    redis: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.REDIS_HOST, 'localhost'),
      port: parseInteger(getEnv(ENV_VARS.REDIS_PORT), 6379, 1, 65535),
      ttl: parseInteger(getEnv('REDIS_TTL'), 60, 1), // Short TTL for tests
      prefix: getEnvWithDefault('REDIS_PREFIX', 'healthcare:test:'),
      enabled: getEnvBoolean('REDIS_ENABLED', true),
      development: true, // Test mode
    },
    jwt: {
      // Use helper functions (which use dotenv) for environment variable access
      secret: getEnvWithDefault(ENV_VARS.JWT_SECRET, 'test-jwt-secret-key-for-testing-only'),
      expiration: getEnvWithDefault(ENV_VARS.JWT_EXPIRATION, '1h'), // Shorter expiration for tests
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
      ttl: parseInteger(getEnv('RATE_LIMIT_TTL'), 10, 1), // Short TTL for tests
      max: parseInteger(getEnv('RATE_LIMIT_MAX'), 1000, 1), // Higher limit for tests
    },
    logging: {
      // Use helper functions (which use dotenv) for environment variable access
      level:
        (getEnvWithDefault(ENV_VARS.LOG_LEVEL, 'error') as
          | 'error'
          | 'warn'
          | 'info'
          | 'debug'
          | 'verbose') || 'error', // Only errors in tests (faster execution)
      enableAuditLogs: getEnvBoolean('ENABLE_AUDIT_LOGS', false), // Disabled for tests
    },
    email: {
      // Use helper functions (which use dotenv) for environment variable access
      host: getEnvWithDefault(ENV_VARS.EMAIL_HOST, 'localhost'),
      port: parseInteger(getEnv(ENV_VARS.EMAIL_PORT), 1025, 1, 65535), // MailHog/MailCatcher port
      secure: getEnvBoolean('EMAIL_SECURE', false),
      user: getEnvWithDefault(ENV_VARS.EMAIL_USER, ''),
      password: getEnvWithDefault(ENV_VARS.EMAIL_PASSWORD, ''),
      from: getEnvWithDefault('EMAIL_FROM', 'test@healthcare.com'),
    },
    cors: {
      // Use helper functions (which use dotenv) for environment variable access
      origin: getEnvWithDefault(ENV_VARS.CORS_ORIGIN, '*'), // Allow all in tests
      credentials: getEnvBoolean('CORS_CREDENTIALS', true),
      methods: getEnvWithDefault('CORS_METHODS', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'),
    },
    security: {
      // Use helper functions (which use dotenv) for environment variable access
      rateLimit: getEnvBoolean('SECURITY_RATE_LIMIT', false), // Disabled for tests
      rateLimitMax: parseInteger(getEnv('SECURITY_RATE_LIMIT_MAX'), 10000, 1), // High limit
      rateLimitWindowMs: parseInteger(getEnv('SECURITY_RATE_LIMIT_WINDOW_MS'), 1000, 100),
      trustProxy: parseInteger(getEnv('TRUST_PROXY'), 0, 0, 2), // No proxy in tests
    },
    whatsapp: {
      // Use helper functions (which use dotenv) for environment variable access
      enabled: getEnvBoolean(ENV_VARS.WHATSAPP_ENABLED, false), // Disabled by default
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
