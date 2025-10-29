import type { Config } from "./config.types";
import { DEFAULT_CONFIG, ENV_VARS } from "./constants";

/**
 * Validates and parses environment variables
 * @param value - The environment variable value
 * @param defaultValue - Default value if parsing fails
 * @param parser - Optional parser function
 * @returns Parsed value or default
 */
function parseEnvVar<T>(
  value: string | undefined,
  defaultValue: T,
  parser?: (val: string) => T,
): T {
  if (!value) {
    return defaultValue;
  }

  if (parser) {
    try {
      return parser(value);
    } catch {
      return defaultValue;
    }
  }

  return value as T;
}

/**
 * Parses integer from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default integer value
 * @returns Parsed integer or default
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  return parseEnvVar(value, defaultValue, (val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      throw new Error(`Invalid integer: ${val}`);
    }
    return parsed;
  });
}

/**
 * Parses boolean from environment variable
 * @param value - Environment variable value
 * @param defaultValue - Default boolean value
 * @returns Parsed boolean or default
 */
function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  return parseEnvVar(
    value,
    defaultValue,
    (val) => val.toLowerCase() === "true",
  );
}

/**
 * Validates required environment variables
 * @param requiredVars - Array of required environment variable names
 * @throws Error if any required variable is missing
 */
function validateRequiredEnvVars(requiredVars: readonly string[]): void {
  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

/**
 * Creates the application configuration
 * @returns Configuration object
 * @throws Error if required environment variables are missing
 */
export default function createConfiguration(): Config {
  // Validate required environment variables in production
  if (process.env["NODE_ENV"] === "production") {
    validateRequiredEnvVars([ENV_VARS.DATABASE_URL, ENV_VARS.JWT_SECRET]);
  }

  return {
    app: {
      port: parseInteger(process.env[ENV_VARS.PORT], DEFAULT_CONFIG.PORT),
      apiPrefix: process.env["API_PREFIX"] || DEFAULT_CONFIG.API_PREFIX,
      environment:
        (process.env[ENV_VARS.NODE_ENV] as
          | "development"
          | "production"
          | "test") || DEFAULT_CONFIG.ENVIRONMENT,
      isDev: process.env[ENV_VARS.NODE_ENV] !== "production",
      host: process.env["HOST"] || "localhost",
      bindAddress: process.env["BIND_ADDRESS"] || "localhost",
      baseUrl:
        process.env["BASE_URL"] ||
        `http://localhost:${process.env["PORT"] || DEFAULT_CONFIG.PORT}`,
      apiUrl:
        process.env["API_URL"] ||
        `http://localhost:${process.env["PORT"] || DEFAULT_CONFIG.PORT}`,
    },
    urls: {
      swagger: process.env["SWAGGER_URL"] || "/docs",
      bullBoard: process.env["BULL_BOARD_URL"] || "/queue-dashboard",
      socket: process.env["SOCKET_URL"] || "/socket.io",
      redisCommander:
        process.env["REDIS_COMMANDER_URL"] || "http://localhost:8082",
      prismaStudio: process.env["PRISMA_STUDIO_URL"] || "http://localhost:5555",
      pgAdmin: process.env["PGADMIN_URL"] || "http://localhost:5050",
      frontend: process.env["FRONTEND_URL"] || "http://localhost:3000",
    },
    database: {
      url:
        process.env[ENV_VARS.DATABASE_URL] ||
        "postgresql://postgres:postgres@localhost:5432/healthcare?schema=public",
    },
    redis: {
      host: process.env[ENV_VARS.REDIS_HOST] || "localhost",
      port: parseInteger(process.env[ENV_VARS.REDIS_PORT], 6379),
      ttl: parseInteger(process.env["REDIS_TTL"], DEFAULT_CONFIG.REDIS_TTL),
      prefix: process.env["REDIS_PREFIX"] || "healthcare:",
      enabled: parseBoolean(process.env["REDIS_ENABLED"], true),
      development: process.env[ENV_VARS.NODE_ENV] === "development",
    },
    jwt: {
      secret:
        process.env[ENV_VARS.JWT_SECRET] ||
        "your-secret-key-change-in-production",
      expiration:
        process.env[ENV_VARS.JWT_EXPIRATION] || DEFAULT_CONFIG.JWT_EXPIRATION,
    },
    prisma: {
      schemaPath:
        process.env["PRISMA_SCHEMA_PATH"] ||
        "./src/libs/infrastructure/database/prisma/schema.prisma",
    },
    rateLimit: {
      ttl: parseInteger(
        process.env["RATE_LIMIT_TTL"],
        DEFAULT_CONFIG.RATE_LIMIT_TTL,
      ),
      max: parseInteger(
        process.env["RATE_LIMIT_MAX"],
        DEFAULT_CONFIG.RATE_LIMIT_MAX,
      ),
    },
    logging: {
      level:
        (process.env[ENV_VARS.LOG_LEVEL] as
          | "error"
          | "warn"
          | "info"
          | "debug"
          | "verbose") || "info",
      enableAuditLogs: parseBoolean(process.env["ENABLE_AUDIT_LOGS"], true),
    },
    email: {
      host: process.env[ENV_VARS.EMAIL_HOST] || "sandbox.smtp.mailtrap.io",
      port: parseInteger(process.env[ENV_VARS.EMAIL_PORT], 2525),
      secure: parseBoolean(process.env["EMAIL_SECURE"], false),
      user: process.env[ENV_VARS.EMAIL_USER] || "",
      password: process.env[ENV_VARS.EMAIL_PASSWORD] || "",
      from: process.env["EMAIL_FROM"] || "noreply@healthcare.com",
    },
    cors: {
      origin:
        process.env[ENV_VARS.CORS_ORIGIN] ||
        "http://localhost:3000,http://localhost:8088",
      credentials: parseBoolean(process.env["CORS_CREDENTIALS"], true),
      methods:
        process.env["CORS_METHODS"] || "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    },
    security: {
      rateLimit: parseBoolean(process.env["SECURITY_RATE_LIMIT"], true),
      rateLimitMax: parseInteger(process.env["SECURITY_RATE_LIMIT_MAX"], 1000),
      rateLimitWindowMs: parseInteger(
        process.env["SECURITY_RATE_LIMIT_WINDOW_MS"],
        15000,
      ),
      trustProxy: parseInteger(process.env["TRUST_PROXY"], 1),
    },
    whatsapp: {
      enabled: parseBoolean(process.env[ENV_VARS.WHATSAPP_ENABLED], false),
      apiUrl:
        process.env["WHATSAPP_API_URL"] || "https://graph.facebook.com/v17.0",
      apiKey: process.env[ENV_VARS.WHATSAPP_API_KEY] || "",
      phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"] || "",
      businessAccountId: process.env["WHATSAPP_BUSINESS_ACCOUNT_ID"] || "",
      otpTemplateId:
        process.env["WHATSAPP_OTP_TEMPLATE_ID"] || "otp_verification",
      appointmentTemplateId:
        process.env["WHATSAPP_APPOINTMENT_TEMPLATE_ID"] ||
        "appointment_reminder",
      prescriptionTemplateId:
        process.env["WHATSAPP_PRESCRIPTION_TEMPLATE_ID"] ||
        "prescription_notification",
    },
  };
}
