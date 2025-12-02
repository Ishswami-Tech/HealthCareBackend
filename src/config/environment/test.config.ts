import type { Config } from '@core/types';
import { ENV_VARS, DEFAULT_CONFIG } from '../constants';
import { parseInteger, parseBoolean } from './utils';

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
      port: parseInteger(process.env[ENV_VARS.PORT], 0, 0, 65535), // Port 0 = random port for tests
      apiPrefix: process.env['API_PREFIX'] || DEFAULT_CONFIG.API_PREFIX,
      environment: 'test' as const,
      isDev: true, // Test mode is like development
      host: process.env['HOST'] || 'localhost',
      bindAddress: process.env['BIND_ADDRESS'] || '127.0.0.1',
      baseUrl: process.env['BASE_URL'] || 'http://localhost:0',
      apiUrl: process.env['API_URL'] || 'http://localhost:0',
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
        process.env['TEST_DATABASE_URL'] ||
        'postgresql://postgres:postgres@localhost:5432/test_userdb?schema=public',
      sqlInjectionPrevention: {
        enabled: parseBoolean(process.env['DB_SQL_INJECTION_PREVENTION'], false), // Disabled for tests
      },
      rowLevelSecurity: {
        enabled: parseBoolean(process.env['DB_ROW_LEVEL_SECURITY'], false), // Disabled for tests
      },
      dataMasking: {
        enabled: parseBoolean(process.env['DB_DATA_MASKING'], false), // Disabled for tests
      },
      rateLimiting: {
        enabled: parseBoolean(process.env['DB_RATE_LIMITING'], false), // Disabled for tests
      },
      readReplicas: {
        enabled: false, // No read replicas in tests
        strategy: 'random',
        urls: [],
      },
    },
    redis: {
      host: process.env[ENV_VARS.REDIS_HOST] || 'localhost',
      port: parseInteger(process.env[ENV_VARS.REDIS_PORT], 6379, 1, 65535),
      ttl: parseInteger(process.env['REDIS_TTL'], 60, 1), // Short TTL for tests
      prefix: process.env['REDIS_PREFIX'] || 'healthcare:test:',
      enabled: parseBoolean(process.env['REDIS_ENABLED'], true),
      development: true, // Test mode
    },
    jwt: {
      secret: process.env[ENV_VARS.JWT_SECRET] || 'test-jwt-secret-key-for-testing-only',
      expiration: process.env[ENV_VARS.JWT_EXPIRATION] || '1h', // Shorter expiration for tests
    },
    prisma: {
      schemaPath:
        process.env['PRISMA_SCHEMA_PATH'] ||
        './src/libs/infrastructure/database/prisma/schema.prisma',
    },
    rateLimit: {
      ttl: parseInteger(process.env['RATE_LIMIT_TTL'], 10, 1), // Short TTL for tests
      max: parseInteger(process.env['RATE_LIMIT_MAX'], 1000, 1), // Higher limit for tests
    },
    logging: {
      level:
        (process.env[ENV_VARS.LOG_LEVEL] as 'error' | 'warn' | 'info' | 'debug' | 'verbose') ||
        'error', // Only errors in tests (faster execution)
      enableAuditLogs: parseBoolean(process.env['ENABLE_AUDIT_LOGS'], false), // Disabled for tests
    },
    email: {
      host: process.env[ENV_VARS.EMAIL_HOST] || 'localhost',
      port: parseInteger(process.env[ENV_VARS.EMAIL_PORT], 1025, 1, 65535), // MailHog/MailCatcher port
      secure: parseBoolean(process.env['EMAIL_SECURE'], false),
      user: process.env[ENV_VARS.EMAIL_USER] || '',
      password: process.env[ENV_VARS.EMAIL_PASSWORD] || '',
      from: process.env['EMAIL_FROM'] || 'test@healthcare.com',
    },
    cors: {
      origin: process.env[ENV_VARS.CORS_ORIGIN] || '*', // Allow all in tests
      credentials: parseBoolean(process.env['CORS_CREDENTIALS'], true),
      methods: process.env['CORS_METHODS'] || 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    },
    security: {
      rateLimit: parseBoolean(process.env['SECURITY_RATE_LIMIT'], false), // Disabled for tests
      rateLimitMax: parseInteger(process.env['SECURITY_RATE_LIMIT_MAX'], 10000, 1), // High limit
      rateLimitWindowMs: parseInteger(process.env['SECURITY_RATE_LIMIT_WINDOW_MS'], 1000, 100),
      trustProxy: parseInteger(process.env['TRUST_PROXY'], 0, 0, 2), // No proxy in tests
    },
    whatsapp: {
      enabled: parseBoolean(process.env[ENV_VARS.WHATSAPP_ENABLED], false), // Disabled by default
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

