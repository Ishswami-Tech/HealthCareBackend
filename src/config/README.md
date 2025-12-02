# Configuration Module - Centralized Configuration Service

## Overview

This module provides a **single source of truth** for all application configuration. All environment variables are loaded through dotenv and accessed via the centralized `ConfigService`.

## Environment File Loading

Environment variables are loaded in the following priority order (later files override earlier ones):

1. **`.env.local`** (highest priority - local overrides, not committed to git)
2. **`.env.{NODE_ENV}`** (environment-specific, e.g., `.env.development`, `.env.production`)
3. **`.env`** (base configuration, lowest priority)

### Example

```bash
# .env
DATABASE_URL=postgresql://localhost:5432/mydb
PORT=3000

# .env.development
PORT=8088  # Overrides .env

# .env.local
DATABASE_URL=postgresql://localhost:5432/localdb  # Overrides both .env and .env.development
```

## Usage

### Import ConfigService

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly config: ConfigService) {}
}
```

### Typed Configuration (Preferred)

Use typed getter methods for type-safe configuration:

```typescript
// Application configuration
const appConfig = this.config.getAppConfig();
const port = appConfig.port; // TypeScript knows this is a number
const isDev = this.config.isDevelopment();

// Database configuration
const dbConfig = this.config.getDatabaseConfig();
const dbUrl = dbConfig.url;

// Cache configuration
const cacheConfig = this.config.getCacheConfig();
const cacheProvider = this.config.getCacheProvider(); // 'redis' | 'dragonfly' | 'memory'
const cacheHost = this.config.getCacheHost(); // Docker-aware (returns 'redis' in Docker, 'localhost' locally)
const cachePort = this.config.getCachePort();

// Redis configuration
const redisConfig = this.config.getRedisConfig();
const redisHost = redisConfig.host; // Docker-aware default

// JWT configuration
const jwtConfig = this.config.getJwtConfig();
const jwtSecret = jwtConfig.secret;

// Rate limit configuration
const rateLimitConfig = this.config.getRateLimitConfig();
const enhancedRateLimit = this.config.getEnhancedRateLimitConfig();

// Logging configuration
const loggingConfig = this.config.getLoggingConfig();
const logLevel = loggingConfig.level;

// Email configuration
const emailConfig = this.config.getEmailConfig();
const emailHost = emailConfig.host;

// CORS configuration
const corsConfig = this.config.getCorsConfig();
const allowedOrigins = corsConfig.origin;

// Security configuration
const securityConfig = this.config.getSecurityConfig();
const rateLimitEnabled = securityConfig.rateLimit;

// WhatsApp configuration
const whatsappConfig = this.config.getWhatsappConfig();
const whatsappEnabled = whatsappConfig.enabled;
```

### Direct Environment Variable Access

For environment variables not in typed configuration, use helper methods:

```typescript
// Get string value
const customVar = this.config.getEnv('CUSTOM_VAR', 'default');

// Get number value
const customPort = this.config.getEnvNumber('CUSTOM_PORT', 3000);

// Get boolean value
const customEnabled = this.config.getEnvBoolean('CUSTOM_ENABLED', false);

// Check if variable exists
if (this.config.hasEnv('CUSTOM_VAR')) {
  // Variable exists
}
```

### Generic Getter (Advanced)

For accessing nested configuration or using dot notation:

```typescript
// Access nested config
const redisHost = this.config.get<string>('redis.host');

// With default value
const redisPort = this.config.get<number>('redis.port', 6379);
```

## Available Configuration Methods

### Application
- `getAppConfig()` - Application configuration (port, environment, URLs)
- `isDevelopment()` - Check if in development mode
- `isProduction()` - Check if in production mode
- `getEnvironment()` - Get current environment

### Database
- `getDatabaseConfig()` - Database configuration

### Cache
- `getCacheConfig()` - Full cache configuration
- `isCacheEnabled()` - Check if cache is enabled
- `getCacheProvider()` - Get cache provider ('redis' | 'dragonfly' | 'memory')
- `getCacheHost()` - Get cache host (provider-agnostic, Docker-aware)
- `getCachePort()` - Get cache port (provider-agnostic)
- `getCachePassword()` - Get cache password (provider-agnostic)
- `getDragonflyHost()` - Get Dragonfly host
- `getDragonflyPort()` - Get Dragonfly port
- `getDragonflyPassword()` - Get Dragonfly password
- `getRedisHost()` - Get Redis host (Docker-aware)
- `getRedisPort()` - Get Redis port
- `getRedisPassword()` - Get Redis password

### Other
- `getRedisConfig()` - Redis configuration
- `getJwtConfig()` - JWT configuration
- `getPrismaConfig()` - Prisma configuration
- `getRateLimitConfig()` - Basic rate limit configuration
- `getEnhancedRateLimitConfig()` - Enhanced rate limit with rules
- `getLoggingConfig()` - Logging configuration
- `getEmailConfig()` - Email configuration
- `getCorsConfig()` - CORS configuration
- `getSecurityConfig()` - Security configuration
- `getWhatsappConfig()` - WhatsApp configuration
- `getUrlsConfig()` - Service URLs configuration
- `getConfig()` - Complete configuration object

### Environment Variable Helpers
- `getEnv(key, defaultValue?)` - Get environment variable as string
- `getEnvNumber(key, defaultValue)` - Get environment variable as number
- `getEnvBoolean(key, defaultValue)` - Get environment variable as boolean
- `hasEnv(key)` - Check if environment variable exists

## Docker Support

The configuration automatically detects Docker environment and uses appropriate defaults:

- **In Docker**: Redis/Dragonfly host defaults to service name (`redis` or `dragonfly`)
- **Local Development**: Redis/Dragonfly host defaults to `localhost`

This is handled automatically - no manual configuration needed.

## Environment Variables

All environment variables are defined in `src/config/constants.ts` as `ENV_VARS`. Use these constants instead of hardcoded strings:

```typescript
import { ENV_VARS } from '@config';

// ✅ CORRECT
const dbUrl = this.config.getEnv(ENV_VARS.DATABASE_URL);

// ❌ FORBIDDEN
const dbUrl = this.config.getEnv('DATABASE_URL');
```

## Best Practices

1. **Always use ConfigService** - Never access `process.env` directly
2. **Use typed getters** - Prefer `getAppConfig()`, `getRedisConfig()`, etc. over `getEnv()`
3. **Use ENV_VARS constants** - Use constants from `@config/constants` instead of hardcoded strings
4. **Provide defaults** - Always provide default values when using `getEnv()`
5. **Type safety** - Use TypeScript types from `@core/types` for configuration objects

## Migration Guide

### Before (Direct process.env)

```typescript
// ❌ OLD WAY
const port = process.env['PORT'] || '8088';
const redisHost = process.env['REDIS_HOST'] || 'localhost';
const isDev = process.env['NODE_ENV'] === 'development';
```

### After (ConfigService)

```typescript
// ✅ NEW WAY
const appConfig = this.config.getAppConfig();
const port = appConfig.port; // Already a number, no parsing needed
const redisHost = this.config.getRedisHost(); // Docker-aware
const isDev = this.config.isDevelopment();
```

## Configuration Files

### Core Files
- `config.module.ts` - Module definition with dotenv loading
- `config.service.ts` - Enhanced ConfigService with typed getters
- `constants.ts` - Environment variable constants and defaults
- `index.ts` - Module exports

### Environment Configurations
- `environment/development.config.ts` - Development environment config
- `environment/production.config.ts` - Production environment config
- `environment/staging.config.ts` - Staging environment config
- `environment/test.config.ts` - Test environment config
- `environment/validation.ts` - Environment variable validation utilities
- `environment/utils.ts` - Shared parsing utilities (parseInteger, parseBoolean, etc.)

### Feature-Specific Configurations
- `cache.config.ts` - Cache configuration factory (Redis/Dragonfly)
- `jwt.config.ts` - JWT module configuration
- `rate-limit.config.ts` - Rate limiting configuration
- `swagger.config.ts` - Swagger/OpenAPI documentation configuration
- `validation-pipe.config.ts` - Validation pipe configuration

## Troubleshooting

### Environment variables not loading

1. Check file priority - `.env.local` overrides `.env.development` which overrides `.env`
2. Verify file exists in project root
3. Check `NODE_ENV` is set correctly
4. Restart the application after changing `.env` files

### Docker connection issues

The configuration automatically detects Docker and uses service names. Ensure:
- `DOCKER_ENV=true` is set in docker-compose.yml
- Service names match (`redis`, `dragonfly`, `postgres`)
- Services are on the same Docker network

### Type errors

Ensure you're using typed getter methods:
```typescript
// ✅ Type-safe
const port: number = this.config.getAppConfig().port;

// ❌ May have type issues
const port = this.config.getEnv('PORT'); // Returns string | undefined
```

