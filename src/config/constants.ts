/**
 * Default cache TTL in seconds (1 hour)
 */
export const CACHE_TTL = 3600 as const;

/**
 * Redis key prefixes for different data types
 * @constant REDIS_PREFIX
 */
export const REDIS_PREFIX = {
  /** All users cache key */
  USERS_ALL: 'users:all',
  /** Single user cache key */
  USERS_ONE: 'users:one',
  /** All clinics cache key */
  CLINICS_ALL: 'clinics:all',
  /** Single clinic cache key */
  CLINICS_ONE: 'clinics:one',
  /** All doctors cache key */
  DOCTORS_ALL: 'doctors:all',
  /** Single doctor cache key */
  DOCTORS_ONE: 'doctors:one',
  /** All patients cache key */
  PATIENTS_ALL: 'patients:all',
  /** Single patient cache key */
  PATIENTS_ONE: 'patients:one',
  /** All appointments cache key */
  APPOINTMENTS_ALL: 'appointments:all',
  /** Single appointment cache key */
  APPOINTMENTS_ONE: 'appointments:one',
  /** User sessions prefix */
  SESSIONS: 'sessions:',
  /** Authentication attempts prefix */
  AUTH_ATTEMPTS: 'auth:attempts:',
  /** Application logs prefix */
  LOGS: 'logs:',
  /** System events prefix */
  EVENTS: 'events:',
} as const;

/**
 * Type for Redis prefix keys
 */
export type RedisPrefixKey = keyof typeof REDIS_PREFIX;

/**
 * Type for Redis prefix values
 */
export type RedisPrefixValue = (typeof REDIS_PREFIX)[RedisPrefixKey];

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  /** Default port */
  PORT: 8088,
  /** Default API prefix */
  API_PREFIX: '/api/v1',
  /** Default environment */
  ENVIRONMENT: 'development' as const,
  /** Default JWT expiration */
  JWT_EXPIRATION: '24h',
  /** Default Redis TTL */
  REDIS_TTL: 3600,
  /** Default rate limit TTL */
  RATE_LIMIT_TTL: 60,
  /** Default rate limit max requests */
  RATE_LIMIT_MAX: 100,
} as const;

/**
 * Environment variable names
 */
export const ENV_VARS = {
  NODE_ENV: 'NODE_ENV',
  PORT: 'PORT',
  DATABASE_URL: 'DATABASE_URL',
  REDIS_HOST: 'REDIS_HOST',
  REDIS_PORT: 'REDIS_PORT',
  JWT_SECRET: 'JWT_SECRET',
  JWT_EXPIRATION: 'JWT_EXPIRATION',
  LOG_LEVEL: 'LOG_LEVEL',
  EMAIL_HOST: 'EMAIL_HOST',
  EMAIL_PORT: 'EMAIL_PORT',
  EMAIL_USER: 'EMAIL_USER',
  EMAIL_PASSWORD: 'EMAIL_PASSWORD',
  CORS_ORIGIN: 'CORS_ORIGIN',
  WHATSAPP_ENABLED: 'WHATSAPP_ENABLED',
  WHATSAPP_API_KEY: 'WHATSAPP_API_KEY',
} as const;

/**
 * Type for environment variable names
 */
export type EnvVarName = keyof typeof ENV_VARS;
