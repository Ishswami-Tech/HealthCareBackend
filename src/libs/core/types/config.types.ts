/**
 * Configuration Types for Healthcare Application
 * @module ConfigTypes
 * @description Centralized type definitions for application configuration
 * All configuration-related types are defined here and imported by config files
 */

/**
 * Application configuration interface
 * @interface AppConfig
 */
export interface AppConfig {
  /** Port number for the application server */
  readonly port: number;
  /** API prefix for all routes */
  readonly apiPrefix: string;
  /** Current environment (development, production, test) */
  readonly environment: 'development' | 'production' | 'test';
  /** Whether the application is in development mode */
  readonly isDev: boolean;
  /** Host address for the application */
  readonly host: string;
  /** Bind address for the server */
  readonly bindAddress: string;
  /** Base URL for the application */
  readonly baseUrl: string;
  /** API URL for the application */
  readonly apiUrl: string;
}

/**
 * URLs configuration interface
 * @interface UrlsConfig
 */
export interface UrlsConfig {
  /** Swagger documentation URL */
  readonly swagger: string;
  /** Bull Board queue dashboard URL */
  readonly bullBoard: string;
  /** Socket.IO URL */
  readonly socket: string;
  /** Redis Commander URL */
  readonly redisCommander: string;
  /** Prisma Studio URL */
  readonly prismaStudio: string;
  /** PgAdmin URL */
  readonly pgAdmin: string;
  /** Frontend URL */
  readonly frontend: string;
}

/**
 * Domains configuration interface
 * @interface DomainsConfig
 */
export interface DomainsConfig {
  /** Main domain */
  readonly main: string;
  /** API domain */
  readonly api: string;
  /** Frontend domain */
  readonly frontend: string;
}

/**
 * Database configuration interface
 * @interface DatabaseConfig
 */
export interface DatabaseConfig {
  /** Database connection URL */
  readonly url: string;
  /** SQL injection prevention configuration */
  readonly sqlInjectionPrevention: {
    readonly enabled: boolean;
  };
  /** Row level security configuration */
  readonly rowLevelSecurity: {
    readonly enabled: boolean;
  };
  /** Data masking configuration */
  readonly dataMasking: {
    readonly enabled: boolean;
  };
  /** Rate limiting configuration */
  readonly rateLimiting: {
    readonly enabled: boolean;
  };
  /** Read replicas configuration */
  readonly readReplicas: {
    readonly enabled: boolean;
    readonly strategy: 'round-robin' | 'random' | 'least-connections';
    readonly urls: readonly string[];
  };
}

/**
 * Redis configuration interface
 * @interface RedisConfig
 */
export interface RedisConfig {
  /** Redis server host */
  readonly host: string;
  /** Redis server port */
  readonly port: number;
  /** Time-to-live for cached items in seconds */
  readonly ttl: number;
  /** Key prefix for all Redis keys */
  readonly prefix: string;
  /** Whether Redis is enabled */
  readonly enabled: boolean;
  /** Whether in development mode */
  readonly development: boolean;
}

/**
 * Cache configuration interface - Single Source of Truth
 * @interface CacheConfig
 * @description Centralized cache configuration
 */
export interface CacheConfig {
  /** Whether cache is enabled (single source of truth) */
  readonly enabled: boolean;
  /** Cache provider type */
  readonly provider: 'redis' | 'dragonfly' | 'memory';
  /** Redis-specific configuration (only if cache is enabled) */
  readonly redis?: {
    readonly host: string;
    readonly port: number;
    readonly password?: string;
    readonly enabled: boolean;
  };
  /** Dragonfly-specific configuration (only if cache is enabled) */
  readonly dragonfly?: {
    readonly host: string;
    readonly port: number;
    readonly password?: string;
    readonly enabled: boolean;
  };
}

/**
 * JWT configuration interface
 * @interface JwtConfig
 */
export interface JwtConfig {
  /** JWT secret key for signing tokens */
  readonly secret: string;
  /** Token expiration time */
  readonly expiration: string;
}

/**
 * Prisma configuration interface
 * @interface PrismaConfig
 */
export interface PrismaConfig {
  /** Path to the Prisma schema file */
  readonly schemaPath: string;
}

/**
 * Rate limiting configuration interface (basic)
 * @interface RateLimitConfig
 */
export interface RateLimitConfig {
  /** Time window for rate limiting in seconds */
  readonly ttl: number;
  /** Maximum number of requests per window */
  readonly max: number;
}

/**
 * Rate limit rule configuration
 * @interface RateLimitRule
 */
export interface RateLimitRule {
  /** Maximum number of requests allowed */
  readonly limit: number;
  /** Time window in seconds */
  readonly window: number;
  /** Allow burst requests (optional) */
  readonly burst?: number;
  /** Request cost multiplier (optional) */
  readonly cost?: number;
}

/**
 * Enhanced rate limit configuration interface
 * @interface EnhancedRateLimitConfig
 */
export interface EnhancedRateLimitConfig {
  /** Whether rate limiting is enabled */
  readonly enabled: boolean;
  /** Rate limit rules for different endpoints */
  readonly rules: {
    readonly [key: string]: RateLimitRule;
  };
  /** Security-related rate limiting settings */
  readonly security: {
    /** Maximum authentication attempts */
    readonly maxAttempts: number;
    /** Authentication attempt window in seconds */
    readonly attemptWindow: number;
    /** Progressive lockout intervals in minutes */
    readonly lockoutIntervals: readonly number[];
    /** Maximum concurrent sessions per user */
    readonly maxConcurrentSessions: number;
    /** Session inactivity threshold in seconds */
    readonly sessionInactivityThreshold: number;
  };
}

/**
 * Logging configuration interface
 * @interface LoggingConfig
 */
export interface LoggingConfig {
  /** Log level (error, warn, info, debug, verbose) */
  readonly level: ConfigLogLevel;
  /** Whether to enable audit logging */
  readonly enableAuditLogs: boolean;
}

/**
 * Email configuration interface
 * @interface EmailConfig
 */
export interface EmailConfig {
  /** SMTP server host */
  readonly host: string;
  /** SMTP server port */
  readonly port: number;
  /** Whether to use secure connection (TLS) */
  readonly secure: boolean;
  /** SMTP username */
  readonly user: string;
  /** SMTP password */
  readonly password: string;
  /** Default sender email address */
  readonly from: string;
}

/**
 * CORS configuration interface
 * @interface CorsConfig
 */
export interface CorsConfig {
  /** Allowed origins (comma-separated) */
  readonly origin: string;
  /** Whether to allow credentials */
  readonly credentials: boolean;
  /** Allowed HTTP methods */
  readonly methods: string;
}

/**
 * Security configuration interface
 * @interface SecurityConfig
 */
export interface SecurityConfig {
  /** Whether rate limiting is enabled */
  readonly rateLimit: boolean;
  /** Maximum requests per window */
  readonly rateLimitMax: number;
  /** Rate limit window in milliseconds */
  readonly rateLimitWindowMs: number;
  /** Trust proxy level */
  readonly trustProxy: number;
}

/**
 * WhatsApp configuration interface
 * @interface WhatsappConfig
 */
export interface WhatsappConfig {
  /** Whether WhatsApp integration is enabled */
  readonly enabled: boolean;
  /** WhatsApp API URL */
  readonly apiUrl: string;
  /** WhatsApp API key */
  readonly apiKey: string;
  /** WhatsApp phone number ID */
  readonly phoneNumberId: string;
  /** WhatsApp business account ID */
  readonly businessAccountId: string;
  /** OTP template ID */
  readonly otpTemplateId: string;
  /** Appointment reminder template ID */
  readonly appointmentTemplateId: string;
  /** Prescription notification template ID */
  readonly prescriptionTemplateId: string;
}

/**
 * Main configuration interface
 * @interface Config
 */
export interface Config {
  /** Application configuration */
  readonly app: AppConfig;
  /** URLs configuration */
  readonly urls: UrlsConfig;
  /** Database configuration */
  readonly database: DatabaseConfig;
  /** Redis configuration */
  readonly redis: RedisConfig;
  /** JWT configuration */
  readonly jwt: JwtConfig;
  /** Prisma configuration */
  readonly prisma: PrismaConfig;
  /** Rate limiting configuration */
  readonly rateLimit: RateLimitConfig;
  /** Logging configuration */
  readonly logging: LoggingConfig;
  /** Email configuration */
  readonly email: EmailConfig;
  /** CORS configuration */
  readonly cors: CorsConfig;
  /** Security configuration */
  readonly security: SecurityConfig;
  /** WhatsApp configuration */
  readonly whatsapp: WhatsappConfig;
}

/**
 * Production configuration interface
 * @interface ProductionConfig
 */
export interface ProductionConfig extends Config {
  /** Domains configuration (production only) */
  readonly domains: DomainsConfig;
}

/**
 * Environment type definition
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * Log level type definition
 * Note: LogLevel enum is defined in logging.types.ts
 * This type is kept for backward compatibility with config interfaces
 */
export type ConfigLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  readonly isValid: boolean;
  /** Array of validation errors */
  readonly errors: readonly string[];
  /** Array of validation warnings */
  readonly warnings: readonly string[];
}
