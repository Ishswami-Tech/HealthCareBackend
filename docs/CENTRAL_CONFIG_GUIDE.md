# Central Configuration Management Guide

This guide explains how all environment variables are managed through the central configuration service (`src/config/config.service.ts`) for both Docker and Kubernetes deployments.

## 📋 Overview

All configuration is managed through:
- **Central Config Service**: `src/config/config.service.ts`
- **Config Module**: `src/config/config.module.ts`
- **Environment Files**: `.env`, `.env.development`, `.env.production`, `.env.local`
- **Config Factories**: Environment-specific config factories in `src/config/environment/`

## 🏗️ Architecture

### Configuration Flow

```
Environment Variables (.env files)
    ↓
Config Factories (development.config.ts, production.config.ts, etc.)
    ↓
Config Module (config.module.ts)
    ↓
Config Service (config.service.ts)
    ↓
Application Code
```

### File Priority

Environment variables are loaded in this order (later files override earlier ones):

1. `.env` (base configuration)
2. `.env.{NODE_ENV}` (environment-specific, e.g., `.env.development`)
3. `.env.local` (local overrides, highest priority, not committed to git)

## 📝 Environment Variables

### All Environment Variables

All environment variables are defined in:
- **Constants**: `src/config/constants.ts` - `ENV_VARS` object
- **Template**: `.env.example` - Complete list with descriptions
- **Environment Files**: `.env.development`, `.env.production`, `.env.local`

### Key Environment Variables

#### Application
- `NODE_ENV` - Environment (development, production, staging, test)
- `PORT` - Server port
- `HOST` - Server host
- `BIND_ADDRESS` - Bind address
- `BASE_URL` - Base URL
- `API_URL` - API URL
- `FRONTEND_URL` - Frontend URL

#### Database
- `DATABASE_URL` - PostgreSQL connection string
- `DIRECT_URL` - Direct PostgreSQL connection (for Prisma Studio)

#### Cache
- `CACHE_ENABLED` - Enable/disable cache
- `CACHE_PROVIDER` - Cache provider (redis, dragonfly, memory)
- `DRAGONFLY_HOST` - Dragonfly host
- `DRAGONFLY_PORT` - Dragonfly port
- `REDIS_HOST` - Redis host
- `REDIS_PORT` - Redis port

#### JWT
- `JWT_SECRET` - JWT signing secret
- `JWT_EXPIRATION` - JWT expiration time

#### Jitsi Meet
- `JITSI_DOMAIN` - Jitsi domain (e.g., meet.ishswami.in or localhost:8443)
- `JITSI_BASE_DOMAIN` - Base domain (e.g., ishswami.in)
- `JITSI_SUBDOMAIN` - Subdomain (e.g., meet)
- `JITSI_APP_ID` - Jitsi application ID
- `JITSI_APP_SECRET` - Jitsi application secret
- `JITSI_BASE_URL` - Jitsi base URL
- `JITSI_WS_URL` - Jitsi WebSocket URL
- `VIDEO_ENABLED` - Enable video consultations
- `JITSI_ENABLE_RECORDING` - Enable recording
- `JITSI_ENABLE_WAITING_ROOM` - Enable waiting room

#### Google OAuth
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - Google OAuth redirect URI

## 🔧 Using Config Service

### Basic Usage

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly configService: ConfigService) {}

  someMethod() {
    // Get Jitsi configuration
    const jitsiConfig = this.configService.getJitsiConfig();
    console.log(jitsiConfig.domain); // meet.ishswami.in
    console.log(jitsiConfig.baseUrl); // https://meet.ishswami.in
    
    // Get app configuration
    const appConfig = this.configService.getAppConfig();
    console.log(appConfig.port); // 8088
    
    // Get cache configuration
    const cacheConfig = this.configService.getCacheConfig();
    console.log(cacheConfig.provider); // dragonfly
    
    // Get environment variable directly
    const customVar = this.configService.getEnv('CUSTOM_VAR', 'default');
  }
}
```

### Available Getter Methods

- `getAppConfig()` - Application configuration
- `getUrlsConfig()` - URLs configuration
- `getDatabaseConfig()` - Database configuration
- `getRedisConfig()` - Redis configuration
- `getJwtConfig()` - JWT configuration
- `getPrismaConfig()` - Prisma configuration
- `getRateLimitConfig()` - Rate limit configuration
- `getLoggingConfig()` - Logging configuration
- `getEmailConfig()` - Email configuration
- `getCorsConfig()` - CORS configuration
- `getSecurityConfig()` - Security configuration
- `getWhatsappConfig()` - WhatsApp configuration
- `getJitsiConfig()` - Jitsi Meet configuration
- `getCacheConfig()` - Cache configuration

## 🐳 Docker Configuration

### Docker Compose

All environment variables in `devops/docker/docker-compose.dev.yml` are passed to containers:

```yaml
services:
  api:
    environment:
      JITSI_DOMAIN: localhost:8443
      JITSI_BASE_DOMAIN: localhost
      JITSI_SUBDOMAIN: localhost
      JITSI_APP_ID: healthcare-jitsi-app
      # ... other variables
```

### Using .env Files with Docker

Docker Compose automatically loads `.env` files. You can also use environment variable substitution:

```yaml
environment:
  JITSI_DOMAIN: ${JITSI_DOMAIN:-localhost:8443}
  GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
```

## ☸️ Kubernetes Configuration

### ConfigMap

Kubernetes ConfigMaps are defined in:
- `devops/kubernetes/base/configmap.yaml` - Main API config
- `devops/kubernetes/base/jitsi-configmap.yaml` - Jitsi-specific config

### Using ConfigMap Values

ConfigMaps are loaded as environment variables in deployments:

```yaml
envFrom:
  - configMapRef:
      name: healthcare-api-config
  - configMapRef:
      name: jitsi-config
```

### Dynamic Domain Configuration

For Kubernetes, use the domain configuration script:

```bash
cd devops/kubernetes/scripts
./configure-jitsi-domain.sh yourdomain.com meet
```

This updates:
- `jitsi-configmap.yaml` - Jitsi domain configuration
- `configmap.yaml` - Main API configuration
- `ingress.yaml` - Ingress routing (manual update required)

## 🔄 Environment-Specific Configuration

### Development

- **File**: `.env.development`
- **Default Domain**: `localhost:8443`
- **Cache**: Dragonfly on `dragonfly:6379`
- **Database**: Local PostgreSQL

### Production

- **File**: `.env.production`
- **Default Domain**: `meet.ishswami.in` (update for your domain)
- **Cache**: Dragonfly on `dragonfly:6379`
- **Database**: Production PostgreSQL

### Local Overrides

- **File**: `.env.local` (not committed to git)
- **Purpose**: Local development overrides
- **Priority**: Highest (overrides all other files)

## 📚 Best Practices

### 1. Always Use Config Service

❌ **Don't:**
```typescript
const domain = process.env.JITSI_DOMAIN;
```

✅ **Do:**
```typescript
const jitsiConfig = this.configService.getJitsiConfig();
const domain = jitsiConfig.domain;
```

### 2. Use Typed Getters

❌ **Don't:**
```typescript
const port = this.configService.get('PORT');
```

✅ **Do:**
```typescript
const appConfig = this.configService.getAppConfig();
const port = appConfig.port;
```

### 3. Provide Defaults

❌ **Don't:**
```typescript
const value = this.configService.getEnv('VAR'); // May be undefined
```

✅ **Do:**
```typescript
const value = this.configService.getEnv('VAR', 'default-value');
```

### 4. Update All Environment Files

When adding a new environment variable:
1. Add to `src/config/constants.ts` - `ENV_VARS`
2. Add to `.env.example` - Template
3. Add to `.env.development` - Development defaults
4. Add to `.env.production` - Production defaults
5. Add to config factory if needed - `development.config.ts`, `production.config.ts`
6. Add to Docker Compose - `docker-compose.dev.yml`
7. Add to Kubernetes ConfigMap - `configmap.yaml` or `jitsi-configmap.yaml`

## 🔍 Troubleshooting

### Variable Not Found

If a variable is not found:
1. Check it's defined in `.env` or `.env.{NODE_ENV}`
2. Check it's in `ENV_VARS` constants
3. Check it's loaded in config factory
4. Restart the application (env vars loaded at startup)

### Wrong Value

If getting wrong value:
1. Check file priority (`.env.local` overrides everything)
2. Check Docker/Kubernetes environment variables
3. Check ConfigMap values in Kubernetes
4. Verify no typos in variable names

### Type Errors

If getting TypeScript errors:
1. Check type definitions in `src/libs/core/types/config.types.ts`
2. Ensure config factory returns correct type
3. Use typed getter methods instead of generic `get()`

## 📖 Additional Resources

- **Config Service**: `src/config/config.service.ts`
- **Config Module**: `src/config/config.module.ts`
- **Type Definitions**: `src/libs/core/types/config.types.ts`
- **Constants**: `src/config/constants.ts`
- **Jitsi Config**: `src/config/jitsi.config.ts`

---

**Note**: All configuration is type-safe and validated at startup. Missing required variables will cause the application to fail to start with clear error messages.
