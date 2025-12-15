# Config Module

**Purpose:** Type-safe configuration management with environment validation
**Location:** `src/config`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly config: ConfigService) {}

  someMethod() {
    // Type-safe config access
    const appConfig = this.config.getAppConfig();
    const port = appConfig.port; // TypeScript knows this is a number

    // Database config
    const dbConfig = this.config.getDatabaseConfig();
    console.log(dbConfig.url);

    // Environment checks
    if (this.config.isDevelopment()) {
      // Dev-specific logic
    }

    // Direct environment variable access
    const customVar = this.config.getEnv('CUSTOM_VAR', 'default');
  }
}
```

---

## Key Features

- ✅ **Type-Safe Configuration** - Full TypeScript type safety with autocomplete
- ✅ **Environment File Priority** - .env.local > .env.{NODE_ENV} > .env
- ✅ **Environment Validation** - Required variables validated on boot
- ✅ **Multi-Provider Support** - Redis/Dragonfly caching, OpenVidu/Jitsi video
- ✅ **Global Module** - Available everywhere via @Global decorator
- ✅ **Zero Runtime Overhead** - Singleton pattern, loaded once at startup
- ✅ **PaymentConfigService** - Multi-tenant payment configuration
- ✅ **CommunicationConfigService** - Multi-tenant communication configuration

---

## Environment File Priority

Environment variables are loaded in this order (later files override earlier):

1. **.env** (base configuration, lowest priority)
2. **.env.{NODE_ENV}** (environment-specific, e.g., .env.development)
3. **.env.local** (local overrides, highest priority, gitignored)

```bash
# Project structure
.env                 # Base configuration (committed)
.env.development     # Development config (committed)
.env.production      # Production config (committed)
.env.staging         # Staging config (committed)
.env.test            # Test config (committed)
.env.local           # Local overrides (gitignored)
```

**Example:**
```env
# .env (base)
DATABASE_URL=postgresql://localhost/healthcare

# .env.production (production-specific)
DATABASE_URL=postgresql://prod-server/healthcare
LOG_LEVEL=warn

# .env.local (local override)
DATABASE_URL=postgresql://localhost/my-local-db
# Overrides both base and environment-specific values
```

---

## Type-Safe Configuration

All configuration is fully typed with TypeScript:

```typescript
// Application configuration
const appConfig = this.config.getAppConfig();
interface AppConfig {
  name: string;
  version: string;
  port: number;
  apiUrl: string;
  environment: 'development' | 'production' | 'test' | 'staging';
  isDev: boolean;
}

// Database configuration
const dbConfig = this.config.getDatabaseConfig();
interface DatabaseConfig {
  url: string;
  maxConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  ssl: boolean;
}

// Redis configuration
const redisConfig = this.config.getRedisConfig();
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
}

// JWT configuration
const jwtConfig = this.config.getJwtConfig();
interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

// Cache configuration
const cacheConfig = this.config.getCacheConfig();
interface CacheConfig {
  enabled: boolean;
  provider: 'redis' | 'dragonfly' | 'memory';
  ttl: number;
  redis?: { host: string; port: number; password?: string };
  dragonfly?: { host: string; port: number; password?: string };
}
```

---

## Configuration Methods

### Application Config

```typescript
// Get app configuration
const appConfig = this.config.getAppConfig();
console.log(appConfig.port); // 8088
console.log(appConfig.environment); // 'development'

// Environment checks
if (this.config.isDevelopment()) {
  console.log('Running in development mode');
}

if (this.config.isProduction()) {
  console.log('Running in production mode');
}

const env = this.config.getEnvironment(); // 'development' | 'production' | 'staging' | 'test'
```

### Database Config

```typescript
const dbConfig = this.config.getDatabaseConfig();
console.log(dbConfig.url);
console.log(dbConfig.maxConnections); // 500
console.log(dbConfig.queryTimeout); // 30000ms
```

### Cache Config

```typescript
// Check cache status
if (this.config.isCacheEnabled()) {
  const provider = this.config.getCacheProvider(); // 'redis' | 'dragonfly' | 'memory'
  console.log(`Cache provider: ${provider}`);
}

// Get provider-specific config
const host = this.config.getCacheHost(); // Returns Dragonfly or Redis host
const port = this.config.getCachePort(); // Returns Dragonfly or Redis port
const password = this.config.getCachePassword(); // Returns Dragonfly or Redis password

// Get Dragonfly config
const dragonflyHost = this.config.getDragonflyHost();
const dragonflyPort = this.config.getDragonflyPort();

// Get Redis config
const redisHost = this.config.getRedisHost();
const redisPort = this.config.getRedisPort();
```

### Video Config

```typescript
// Check video status
if (this.config.isVideoEnabled()) {
  const provider = this.config.getVideoProvider(); // 'openvidu' | 'jitsi'
  console.log(`Video provider: ${provider}`);
}

// Get video configuration
const videoConfig = this.config.getVideoConfig();
console.log(videoConfig.provider); // 'openvidu' | 'jitsi'
console.log(videoConfig.openvidu?.url);
console.log(videoConfig.jitsi?.url);
```

### Rate Limit Config

```typescript
// Basic rate limit config
const rateLimitConfig = this.config.getRateLimitConfig();
console.log(rateLimitConfig.max); // 100
console.log(rateLimitConfig.ttl); // 60

// Enhanced rate limit config (with rules)
const enhancedConfig = this.config.getEnhancedRateLimitConfig();
console.log(enhancedConfig.rules['api'].limit); // 100
console.log(enhancedConfig.rules['auth'].limit); // 10
```

### Direct Environment Variable Access

```typescript
// Get environment variable (string)
const customVar = this.config.getEnv('CUSTOM_VAR', 'default-value');

// Get as number
const timeout = this.config.getEnvNumber('TIMEOUT', 5000);

// Get as boolean
const enableFeature = this.config.getEnvBoolean('ENABLE_FEATURE', false);

// Check if variable exists
if (this.config.hasEnv('OPTIONAL_VAR')) {
  console.log('Optional variable is set');
}
```

---

## Environment Validation

Configuration is validated on boot:

```typescript
// Required variables for production/staging
const requiredProduction = [
  'DATABASE_URL',
  'JWT_SECRET',
  'REDIS_HOST',
  'CACHE_PROVIDER',
  // ... more required vars
];

// Validation runs automatically in main.ts
// Throws error if required variables are missing in production/staging
```

**Validation Levels:**
- **Production/Staging:** Strict - throws error if required vars missing
- **Development:** Warnings only for missing recommended vars
- **Test:** No validation (allows minimal config)

---

## Multi-Tenant Configuration

### Payment Configuration

```typescript
import { PaymentConfigService } from '@config';

// Get clinic payment configuration
const config = await this.paymentConfigService.getClinicConfig(clinicId);

// Payment provider config
console.log(config.payment.primary.provider); // 'razorpay' | 'phonepe'
console.log(config.payment.primary.apiKey);
console.log(config.payment.fallback); // Fallback providers

// Set clinic payment configuration
await this.paymentConfigService.setClinicConfig(clinicId, {
  payment: {
    primary: {
      provider: 'razorpay',
      apiKey: 'rzp_live_xxx',
      apiSecret: 'encrypted_secret',
      enabled: true,
    },
  },
});
```

### Communication Configuration

```typescript
import { CommunicationConfigService } from '@communication/config';

// Get clinic communication configuration
const config = await this.communicationConfigService.getClinicConfig(clinicId);

// Email provider config
console.log(config.email.provider); // 'ses' | 'smtp' | 'sendgrid'
console.log(config.email.fromAddress);

// WhatsApp provider config
console.log(config.whatsapp.provider); // 'meta' | 'twilio'
console.log(config.whatsapp.businessPhoneId);
```

---

## Configuration Files

Configuration is organized by environment:

```
src/config/
├── config.module.ts           # Global config module
├── config.service.ts          # Enhanced type-safe service
├── payment-config.service.ts  # Multi-tenant payment config
├── constants.ts               # Environment variable constants
├── cache.config.ts            # Cache provider configuration
├── rate-limit.config.ts       # Rate limiting rules
├── video.config.ts            # Video provider configuration
├── jwt.config.ts              # JWT configuration
├── swagger.config.ts          # Swagger/OpenAPI config
├── validation-pipe.config.ts  # Input validation config
└── environment/
    ├── development.config.ts  # Development config
    ├── production.config.ts   # Production config
    ├── staging.config.ts      # Staging config
    ├── test.config.ts         # Test config
    ├── validation.ts          # Environment validation
    └── utils.ts               # Config utilities
```

---

## Usage Examples

### Basic Configuration Access

```typescript
import { ConfigService } from '@config';

@Injectable()
export class DatabaseService {
  constructor(private readonly config: ConfigService) {
    const dbConfig = this.config.getDatabaseConfig();
    this.connect(dbConfig.url);
  }
}
```

### Environment-Specific Logic

```typescript
import { ConfigService } from '@config';

@Injectable()
export class LoggingService {
  constructor(private readonly config: ConfigService) {}

  log(message: string) {
    if (this.config.isDevelopment()) {
      console.log(`[DEV] ${message}`);
    } else if (this.config.isProduction()) {
      // Send to external logging service
      this.externalLogger.log(message);
    }
  }
}
```

### Multi-Provider Support

```typescript
import { ConfigService } from '@config';

@Injectable()
export class CacheService {
  constructor(private readonly config: ConfigService) {
    const provider = this.config.getCacheProvider();

    if (provider === 'dragonfly') {
      this.initDragonfly();
    } else if (provider === 'redis') {
      this.initRedis();
    } else {
      this.initMemory();
    }
  }

  private initDragonfly() {
    const host = this.config.getDragonflyHost();
    const port = this.config.getDragonflyPort();
    const password = this.config.getDragonflyPassword();
    // Connect to Dragonfly
  }
}
```

### Feature Flags

```typescript
import { ConfigService } from '@config';

@Injectable()
export class FeatureService {
  constructor(private readonly config: ConfigService) {}

  async checkFeature(feature: string): Promise<boolean> {
    const enabledFeatures = this.config.getEnv('ENABLED_FEATURES', '');
    return enabledFeatures.split(',').includes(feature);
  }
}
```

---

## Environment Variables

See `.env.example` for complete list. Key variables:

```env
# Application
NODE_ENV=development          # development | production | staging | test
PORT=8088
API_URL=http://localhost:8088

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/healthcare
DATABASE_MAX_CONNECTIONS=500
DATABASE_QUERY_TIMEOUT=30000

# Cache (Redis/Dragonfly)
CACHE_PROVIDER=dragonfly      # redis | dragonfly | memory
DRAGONFLY_HOST=localhost
DRAGONFLY_PORT=6379
REDIS_HOST=localhost
REDIS_PORT=6379

# Video (OpenVidu/Jitsi)
VIDEO_PROVIDER=openvidu       # openvidu | jitsi
OPENVIDU_URL=https://openvidu.example.com
OPENVIDU_SECRET=secret
JITSI_URL=https://meet.jit.si

# JWT
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute

# CORS
CORS_ORIGIN=http://localhost:3000,https://app.example.com

# Email
EMAIL_PROVIDER=ses            # ses | smtp | sendgrid
EMAIL_FROM=noreply@example.com

# WhatsApp
WHATSAPP_PROVIDER=meta        # meta | twilio
```

---

## Troubleshooting

**Issue: Configuration value is undefined**
```typescript
// 1. Check environment file priority
// Make sure variable is in correct .env file

// 2. Use default values
const value = this.config.getEnv('MY_VAR', 'default-value');

// 3. Check if variable exists
if (!this.config.hasEnv('MY_VAR')) {
  throw new Error('MY_VAR is required');
}

// 4. Use typed getter methods instead of generic get
const appConfig = this.config.getAppConfig(); // Prefer this
const port = this.config.get<number>('app.port'); // Over this
```

**Issue: Type errors in configuration**
```typescript
// 1. Use typed getter methods
const dbConfig = this.config.getDatabaseConfig();
// TypeScript knows the exact type

// 2. Avoid generic get for complex types
// BAD: const config = this.config.get<AppConfig>('app');
// GOOD: const config = this.config.getAppConfig();
```

**Issue: Environment validation fails**
```typescript
// 1. Check required variables for your environment
// Production/staging require all critical variables

// 2. Add variable to .env file
DATABASE_URL=postgresql://localhost/healthcare

// 3. Restart application after .env changes
```

**Issue: Multi-provider config not working**
```typescript
// 1. Check provider setting
const provider = this.config.getCacheProvider();
console.log(`Using provider: ${provider}`);

// 2. Ensure provider-specific variables are set
// For Dragonfly: DRAGONFLY_HOST, DRAGONFLY_PORT
// For Redis: REDIS_HOST, REDIS_PORT

// 3. Use provider-agnostic getters
const host = this.config.getCacheHost(); // Works for both
```

---

## Best Practices

1. **Always use typed getter methods**
   ```typescript
   // GOOD
   const appConfig = this.config.getAppConfig();

   // BAD
   const port = this.config.get<number>('app.port');
   ```

2. **Provide defaults for optional variables**
   ```typescript
   const timeout = this.config.getEnvNumber('TIMEOUT', 5000);
   ```

3. **Use environment checks for conditional logic**
   ```typescript
   if (this.config.isDevelopment()) {
     // Development-only code
   }
   ```

4. **Validate critical configuration on boot**
   ```typescript
   if (!this.config.hasEnv('JWT_SECRET')) {
     throw new Error('JWT_SECRET is required');
   }
   ```

5. **Use .env.local for local overrides**
   - Never commit .env.local (add to .gitignore)
   - Use for local development overrides
   - Highest priority, overrides all other files

---

## Architecture

```
ConfigModule (@Global)
├── ConfigService (type-safe wrapper)
│   ├── getAppConfig()
│   ├── getDatabaseConfig()
│   ├── getRedisConfig()
│   ├── getCacheConfig()
│   ├── getVideoConfig()
│   └── ... more typed getters
├── PaymentConfigService (multi-tenant)
│   ├── getClinicConfig()
│   └── setClinicConfig()
└── Configuration Files
    ├── environment/
    │   ├── development.config.ts
    │   ├── production.config.ts
    │   ├── staging.config.ts
    │   └── test.config.ts
    ├── cache.config.ts
    ├── video.config.ts
    ├── rate-limit.config.ts
    └── ... more config files
```

**Flow:**
1. loadEnvironmentVariables() loads .env files (priority order)
2. getConfigFactory() selects environment config
3. validateConfigEarly() validates required variables
4. ConfigModule imports all config factories
5. ConfigService provides type-safe access
6. PaymentConfigService/CommunicationConfigService provide multi-tenant config

---

## Related Documentation

- [System Architecture](../docs/architecture/SYSTEM_ARCHITECTURE.md)
- [Environment Setup](../QUICK_START_LOCAL.md)
- [Payment Configuration](../libs/payment/README.md)
- [Communication Configuration](../libs/communication/README.md)

---

## Contributing

See main [README.md](../README.md) for contribution guidelines.
