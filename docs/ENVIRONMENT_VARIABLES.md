# Environment Variables Reference

Complete list of all environment variables used in the Healthcare Backend
application, organized by category.

## 📋 Quick Reference

All environment variables are managed through the central configuration service
(`src/config/config.service.ts`). See `docs/DEVELOPER_GUIDE.md` for usage
instructions.

---

## ⚠️ Required Environment Variables (No Hardcoded URLs)

**Important:** All URLs and domains must be set via environment variables. The
codebase no longer contains hardcoded URLs, domains, or secrets.

### Critical Variables (Application Won't Start Without These)

**Production:**

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Security
JWT_SECRET=your-super-secret-key-min-32-chars

# URLs (NO HARDCODED DEFAULTS - MUST BE SET)
HOST=backend-service-v1.ishswami.in
API_URL=https://backend-service-v1.ishswami.in
BASE_URL=https://backend-service-v1.ishswami.in
FRONTEND_URL=https://ishswami.in
```

**Staging:**

```env
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=your-super-secret-key-min-32-chars
HOST=staging-api.ishswami.in
API_URL=https://staging-api.ishswami.in
BASE_URL=https://staging-api.ishswami.in
FRONTEND_URL=https://staging.ishswami.in
```

### What Changed

**Before (❌ Had Hardcoded URLs):**

```typescript
host: getEnvWithDefault(ENV_VARS.HOST, 'api.ishswami.in'),
apiUrl: getEnvWithDefault(ENV_VARS.API_URL, 'https://api.ishswami.in'),
```

**After (✅ No Hardcoded URLs):**

```typescript
host:
  getEnv(ENV_VARS.HOST) ||
  (() => {
    throw new Error(
      `Missing required environment variable: ${ENV_VARS.HOST}. Please set HOST in .env.production`
    );
  })(),
```

### Breaking Changes

**If you don't set these environment variables, the application will fail to
start with clear error messages:**

```
Error: Missing required environment variable: HOST. Please set HOST in .env.production
Error: Missing required environment variable: API_URL. Please set API_URL in .env.production
Error: Missing required environment variable: FRONTEND_URL. Please set FRONTEND_URL in .env.production
```

### Benefits

1. **Security**: No secrets or URLs in code
2. **Flexibility**: Easy to change domains without code changes
3. **Multi-tenant**: Different domains per deployment
4. **Compliance**: Better for HIPAA/security audits
5. **Clear Errors**: Application fails fast with helpful error messages

### Files Updated

- ✅ `src/config/environment/production.config.ts` - Removed all hardcoded URLs
- ✅ `src/config/environment/staging.config.ts` - Removed all hardcoded URLs
- ✅ `src/config/environment/validation.ts` - Added HOST, API_URL, BASE_URL,
  FRONTEND_URL to required vars
- ✅ `src/services/billing/invoice-pdf.service.ts` - Removed hardcoded API URL
- ✅ `src/services/auth/auth.service.ts` - Removed hardcoded frontend URL
- ✅ `src/services/video/providers/openvidu-video.provider.ts` - Removed
  hardcoded domain

---

## 🔧 Application Configuration

| Variable       | Description                                          | Default       | Required             |
| -------------- | ---------------------------------------------------- | ------------- | -------------------- |
| `NODE_ENV`     | Environment (development, production, staging, test) | `development` | No                   |
| `IS_DEV`       | Development mode flag                                | `true`        | No                   |
| `PORT`         | Server port                                          | `8088`        | No                   |
| `HOST`         | Server host/domain                                   | -             | **Yes** (production) |
| `BIND_ADDRESS` | Bind address                                         | `0.0.0.0`     | No                   |
| `BASE_URL`     | Base URL                                             | -             | **Yes** (production) |
| `API_URL`      | API URL                                              | -             | **Yes** (production) |
| `FRONTEND_URL` | Frontend URL                                         | -             | **Yes** (production) |
| `API_PREFIX`   | API prefix                                           | `/api/v1`     | No                   |

## 🗄️ Database Configuration

| Variable                                    | Description                                      | Default       | Required             |
| ------------------------------------------- | ------------------------------------------------ | ------------- | -------------------- |
| `DATABASE_URL`                              | PostgreSQL connection string                     | -             | **Yes** (production) |
| `DIRECT_URL`                                | Direct PostgreSQL connection (for Prisma Studio) | -             | No                   |
| `DATABASE_SQL_INJECTION_PREVENTION_ENABLED` | Enable SQL injection prevention                  | `false`       | No                   |
| `DATABASE_ROW_LEVEL_SECURITY_ENABLED`       | Enable row-level security                        | `false`       | No                   |
| `DATABASE_DATA_MASKING_ENABLED`             | Enable data masking                              | `false`       | No                   |
| `DATABASE_RATE_LIMITING_ENABLED`            | Enable database rate limiting                    | `false`       | No                   |
| `DATABASE_READ_REPLICAS_ENABLED`            | Enable read replicas                             | `false`       | No                   |
| `DATABASE_READ_REPLICAS_STRATEGY`           | Read replica strategy (round-robin, random)      | `round-robin` | No                   |
| `DATABASE_READ_REPLICAS_URLS`               | Comma-separated read replica URLs                | -             | No                   |

## 💾 Cache Configuration

| Variable               | Description                               | Default                            | Required |
| ---------------------- | ----------------------------------------- | ---------------------------------- | -------- |
| `CACHE_ENABLED`        | Enable cache                              | `true`                             | No       |
| `CACHE_PROVIDER`       | Cache provider (redis, dragonfly, memory) | `dragonfly`                        | No       |
| `DRAGONFLY_HOST`       | Dragonfly host                            | `dragonfly` (Docker) / `localhost` | No       |
| `DRAGONFLY_PORT`       | Dragonfly port                            | `6379`                             | No       |
| `DRAGONFLY_KEY_PREFIX` | Dragonfly key prefix                      | `healthcare:`                      | No       |
| `DRAGONFLY_PASSWORD`   | Dragonfly password                        | -                                  | No       |
| `DRAGONFLY_ENABLED`    | Enable Dragonfly                          | `true`                             | No       |
| `REDIS_HOST`           | Redis host                                | `redis` (Docker) / `localhost`     | No       |
| `REDIS_PORT`           | Redis port                                | `6379`                             | No       |
| `REDIS_TTL`            | Redis TTL (seconds)                       | `3600`                             | No       |
| `REDIS_PREFIX`         | Redis key prefix                          | `healthcare:`                      | No       |
| `REDIS_PASSWORD`       | Redis password                            | -                                  | No       |
| `REDIS_ENABLED`        | Enable Redis                              | `true`                             | No       |
| `REDIS_MAX_MEMORY`     | Redis max memory                          | `2gb`                              | No       |
| `REDIS_POLICY`         | Redis eviction policy                     | `allkeys-lru`                      | No       |

## 🔐 JWT Configuration

| Variable                 | Description                  | Default | Required             |
| ------------------------ | ---------------------------- | ------- | -------------------- |
| `JWT_SECRET`             | JWT signing secret           | -       | **Yes** (production) |
| `JWT_EXPIRATION`         | JWT expiration time          | `24h`   | No                   |
| `JWT_ACCESS_EXPIRES_IN`  | JWT access token expiration  | `24h`   | No                   |
| `JWT_REFRESH_EXPIRES_IN` | JWT refresh token expiration | `7d`    | No                   |
| `JWT_REFRESH_SECRET`     | JWT refresh secret           | -       | No                   |

## 🎥 Jitsi Meet Configuration

| Variable                    | Description                                                 | Default                | Required               |
| --------------------------- | ----------------------------------------------------------- | ---------------------- | ---------------------- |
| `JITSI_DOMAIN`              | Jitsi domain (e.g., `meet.ishswami.in` or `localhost:8443`) | `localhost:8443`       | No                     |
| `JITSI_BASE_DOMAIN`         | Base domain (e.g., `ishswami.in`)                           | Auto-calculated        | No                     |
| `JITSI_SUBDOMAIN`           | Subdomain (e.g., `meet`)                                    | Auto-calculated        | No                     |
| `JITSI_APP_ID`              | Jitsi application ID for JWT                                | `healthcare-jitsi-app` | No                     |
| `JITSI_APP_SECRET`          | Jitsi application secret for JWT token generation           | -                      | **Yes** (for JWT auth) |
| `JITSI_BASE_URL`            | Base URL for Jitsi web interface                            | Auto-calculated        | No                     |
| `JITSI_WS_URL`              | WebSocket URL for XMPP communication                        | Auto-calculated        | No                     |
| `VIDEO_ENABLED`             | Enable video consultations                                  | `true`                 | No                     |
| `JITSI_ENABLE_RECORDING`    | Enable recording                                            | `true`                 | No                     |
| `JITSI_ENABLE_WAITING_ROOM` | Enable waiting room                                         | `true`                 | No                     |

**Note:** Jitsi configuration is accessed via `configService.getJitsiConfig()`
in code.

## 🔑 Google OAuth Configuration

| Variable               | Description                | Default | Required |
| ---------------------- | -------------------------- | ------- | -------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     | -       | No       |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | -       | No       |
| `GOOGLE_REDIRECT_URI`  | Google OAuth redirect URI  | -       | No       |

## 📧 Email Configuration

| Variable             | Description                 | Default                  | Required |
| -------------------- | --------------------------- | ------------------------ | -------- |
| `EMAIL_PROVIDER`     | Email provider (api, smtp)  | `api`                    | No       |
| `EMAIL_HOST`         | SMTP server host            | `live.smtp.mailtrap.io`  | No       |
| `EMAIL_PORT`         | SMTP server port            | `2525`                   | No       |
| `EMAIL_SECURE`       | Use secure connection (TLS) | `false`                  | No       |
| `EMAIL_USER`         | SMTP username               | -                        | No       |
| `EMAIL_PASSWORD`     | SMTP password               | -                        | No       |
| `EMAIL_FROM`         | Default sender email        | `noreply@healthcare.com` | No       |
| `MAILTRAP_API_TOKEN` | Mailtrap API token          | -                        | No       |

## 🌐 CORS Configuration

| Variable           | Description                       | Default                                  | Required |
| ------------------ | --------------------------------- | ---------------------------------------- | -------- |
| `CORS_ORIGIN`      | Allowed origins (comma-separated) | `http://localhost:3000,...`              | No       |
| `CORS_CREDENTIALS` | Allow credentials                 | `true`                                   | No       |
| `CORS_METHODS`     | Allowed HTTP methods              | `GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS` | No       |

## 🔒 Security Configuration

| Variable                        | Description                   | Default | Required             |
| ------------------------------- | ----------------------------- | ------- | -------------------- |
| `SECURITY_RATE_LIMIT`           | Enable security rate limiting | `true`  | No                   |
| `SECURITY_RATE_LIMIT_MAX`       | Max requests per window       | `1000`  | No                   |
| `SECURITY_RATE_LIMIT_WINDOW_MS` | Rate limit window (ms)        | `15000` | No                   |
| `TRUST_PROXY`                   | Trust proxy level             | `1`     | No                   |
| `SESSION_SECRET`                | Session secret (min 32 chars) | -       | **Yes** (production) |
| `COOKIE_SECRET`                 | Cookie secret (min 32 chars)  | -       | **Yes** (production) |

## ⚡ Rate Limiting Configuration

| Variable                       | Description                            | Default    | Required |
| ------------------------------ | -------------------------------------- | ---------- | -------- |
| `RATE_LIMIT_ENABLED`           | Enable rate limiting                   | `true`     | No       |
| `RATE_LIMIT_TTL`               | Rate limit TTL (seconds)               | `60`       | No       |
| `RATE_LIMIT_MAX`               | Max requests per window                | `100`      | No       |
| `RATE_LIMIT_WINDOW`            | Rate limit window                      | `1 minute` | No       |
| `API_RATE_LIMIT`               | API endpoint rate limit                | `100`      | No       |
| `AUTH_RATE_LIMIT`              | Auth endpoint rate limit               | `5`        | No       |
| `HEAVY_RATE_LIMIT`             | Heavy operation rate limit             | `10`       | No       |
| `USER_RATE_LIMIT`              | User endpoint rate limit               | `50`       | No       |
| `HEALTH_RATE_LIMIT`            | Health check rate limit                | `200`      | No       |
| `MAX_AUTH_ATTEMPTS`            | Max authentication attempts            | `5`        | No       |
| `AUTH_ATTEMPT_WINDOW`          | Auth attempt window (seconds)          | `1800`     | No       |
| `MAX_CONCURRENT_SESSIONS`      | Max concurrent sessions per user       | `5`        | No       |
| `SESSION_INACTIVITY_THRESHOLD` | Session inactivity threshold (seconds) | `900`      | No       |

## 📝 Logging Configuration

| Variable            | Description                                   | Default | Required |
| ------------------- | --------------------------------------------- | ------- | -------- |
| `LOG_LEVEL`         | Log level (error, warn, info, debug, verbose) | `debug` | No       |
| `LOG_FORMAT`        | Log format (json, pretty)                     | `json`  | No       |
| `ENABLE_AUDIT_LOGS` | Enable audit logging                          | `true`  | No       |

## 📱 WhatsApp Configuration

| Variable                            | Description                  | Default                            | Required |
| ----------------------------------- | ---------------------------- | ---------------------------------- | -------- |
| `WHATSAPP_ENABLED`                  | Enable WhatsApp integration  | `false`                            | No       |
| `WHATSAPP_API_URL`                  | WhatsApp API URL             | `https://graph.facebook.com/v17.0` | No       |
| `WHATSAPP_API_KEY`                  | WhatsApp API key             | -                                  | No       |
| `WHATSAPP_PHONE_NUMBER_ID`          | WhatsApp phone number ID     | -                                  | No       |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`      | WhatsApp business account ID | -                                  | No       |
| `WHATSAPP_OTP_TEMPLATE_ID`          | OTP template ID              | `otp_verification`                 | No       |
| `WHATSAPP_APPOINTMENT_TEMPLATE_ID`  | Appointment template ID      | `appointment_reminder`             | No       |
| `WHATSAPP_PRESCRIPTION_TEMPLATE_ID` | Prescription template ID     | `prescription_notification`        | No       |

## 💾 Storage Configuration (S3-compatible)

| Variable                   | Description                                                                                                                                                                                                                                                           | Default                                      | Required                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| `S3_ENABLED`               | Enable S3 storage                                                                                                                                                                                                                                                     | `false`                                      | No                        |
| `S3_PROVIDER`              | S3 provider (contabo, aws, wasabi, custom)                                                                                                                                                                                                                            | `contabo`                                    | No                        |
| `S3_ENDPOINT`              | S3 endpoint URL                                                                                                                                                                                                                                                       | `https://eu2.contabostorage.com`             | No (required for Contabo) |
| `S3_REGION`                | S3 region                                                                                                                                                                                                                                                             | `eu-central-1` (Contabo) / `us-east-1` (AWS) | No                        |
| `S3_BUCKET`                | S3 bucket name                                                                                                                                                                                                                                                        | -                                            | No                        |
| `S3_ACCESS_KEY_ID`         | S3 access key ID                                                                                                                                                                                                                                                      | -                                            | No                        |
| `S3_SECRET_ACCESS_KEY`     | S3 secret access key                                                                                                                                                                                                                                                  | -                                            | No                        |
| `S3_FORCE_PATH_STYLE`      | Force path-style URLs                                                                                                                                                                                                                                                 | `true` (Contabo) / `false` (AWS)             | No                        |
| `S3_PUBLIC_URL_EXPIRATION` | Presigned URL expiration (seconds)                                                                                                                                                                                                                                    | `3600`                                       | No                        |
| `CDN_URL`                  | CDN URL for public assets                                                                                                                                                                                                                                             | Auto-generated (Contabo)                     | No                        |
|                            | **Note**: For Contabo provider, CDN URL is automatically generated from `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_BUCKET`. Format: `https://{endpoint}/{access-key-id}:{bucket}`. Only set this if using a different CDN provider (e.g., Cloudflare, AWS CloudFront) |                                              |                           |

**See Also**: [Storage Configuration Guide](guides/STORAGE_CONFIGURATION.md) for
detailed setup instructions.

## 🛠️ Service URLs

| Variable              | Description                    | Default                 | Required |
| --------------------- | ------------------------------ | ----------------------- | -------- |
| `SWAGGER_URL`         | Swagger documentation URL      | `/docs`                 | No       |
| `BULL_BOARD_URL`      | Bull Board queue dashboard URL | `/queue-dashboard`      | No       |
| `SOCKET_URL`          | Socket.IO URL                  | `/socket.io`            | No       |
| `REDIS_COMMANDER_URL` | Redis Commander URL            | `http://localhost:8082` | No       |
| `PRISMA_STUDIO_URL`   | Prisma Studio URL              | `http://localhost:5555` | No       |
| `PGADMIN_URL`         | PgAdmin URL                    | `http://localhost:5050` | No       |
| `LOGGER_URL`          | Logger URL                     | `/logger`               | No       |

## 🐳 Docker Configuration

| Variable         | Description             | Default       | Required |
| ---------------- | ----------------------- | ------------- | -------- |
| `DOCKER_ENV`     | Docker environment flag | `false`       | No       |
| `DOCKER_NETWORK` | Docker network name     | `app-network` | No       |

## 📦 Prisma Configuration

| Variable             | Description                | Default                                                   | Required |
| -------------------- | -------------------------- | --------------------------------------------------------- | -------- |
| `PRISMA_SCHEMA_PATH` | Path to Prisma schema file | `./src/libs/infrastructure/database/prisma/schema.prisma` | No       |

## 📚 Usage in Code

### Using ConfigService

```typescript
import { ConfigService } from '@config';

@Injectable()
export class MyService {
  constructor(private readonly configService: ConfigService) {}

  someMethod() {
    // Get Jitsi configuration
    const jitsiConfig = this.configService.getJitsiConfig();
    console.log(jitsiConfig.domain); // meet.ishswami.in or localhost:8443
    console.log(jitsiConfig.baseUrl); // https://meet.ishswami.in

    // Get app configuration
    const appConfig = this.configService.getAppConfig();
    console.log(appConfig.port); // 8088

    // Get environment variable directly (for variables not in typed config)
    const customVar = this.configService.getEnv('CUSTOM_VAR', 'default');
  }
}
```

## 🔄 Environment File Priority

Environment variables are loaded in this order (later files override earlier
ones):

1. `.env` (base configuration)
2. `.env.{NODE_ENV}` (environment-specific, e.g., `.env.development`)
3. `.env.local` (local overrides, highest priority, not committed to git)

## 📝 Required Variables by Environment

### Development

- `DATABASE_URL` (recommended)
- `JWT_SECRET` (recommended)

### Production

- `DATABASE_URL` (**required**)
- `JWT_SECRET` (**required**)
- `SESSION_SECRET` (**required**)
- `COOKIE_SECRET` (**required**)
- `JITSI_APP_SECRET` (required for JWT authentication)

## 🔍 See Also

- **GitHub Secrets Reference**:
  [GITHUB_SECRETS_REFERENCE.md](./GITHUB_SECRETS_REFERENCE.md) - Complete list
  of secrets for CI/CD deployment
- **Production Template**:
  [PRODUCTION_ENV_TEMPLATE.txt](./PRODUCTION_ENV_TEMPLATE.txt) - Template file
  for production environment variables
- **Developer Guide**: [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) (includes
  configuration management)
- **Deployment Guide**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) -
  Environment variable setup for deployment
- **Jitsi Setup**: `devops/kubernetes/JITSI_SETUP.md`
- **Config Service**: `src/config/config.service.ts`
- **Config Types**: `src/libs/core/types/config.types.ts`
- **Constants**: `src/config/constants.ts`

---

**Note**: All configuration is type-safe and validated at startup. Missing
required variables will cause the application to fail to start with clear error
messages.
