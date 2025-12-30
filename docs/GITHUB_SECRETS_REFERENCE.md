# GitHub Secrets Reference Guide
## Complete List of Required Secrets for CI/CD Deployment

This document provides a comprehensive reference for all GitHub Secrets required for the Healthcare Backend CI/CD pipeline.

## 🏗️ Architecture Overview

**Single Backend API, Multiple Clinic Frontends**
- **ONE backend API** (`api.ishswami.in`) serves ALL clinics
- **Only clinic-related data and configurations differ** between clinics
- All clinics share the same backend infrastructure (database, cache, services)
- Each clinic can have separate frontend URL and clinic-specific credentials
- Row-level security ensures automatic data isolation by clinic

This document includes both global secrets (shared by all clinics) and clinic-specific secrets (unique per clinic).

---

## 📋 Table of Contents

1. [Global Secrets](#global-secrets)
2. [Clinic-Specific Secrets](#clinic-specific-secrets)
3. [Secret Naming Patterns](#secret-naming-patterns)
4. [Adding New Clinics](#adding-new-clinics)
5. [Priority Order](#priority-order)

---

## 🔑 Global Secrets

These secrets apply to all clinics and serve as fallback defaults.

### Application Configuration
- `NODE_ENV` - Environment (production)
- `IS_DEV` - Development flag (false)
- `PORT` - Application port (8088)
- `API_PREFIX` - API prefix (/api/v1)
- `HOST` - Host address (api.ishswami.in)
- `BIND_ADDRESS` - Bind address (0.0.0.0)
- `BASE_URL` - Base URL (https://api.ishswami.in)
- `API_URL` - API URL (https://api.ishswami.in)
- `FRONTEND_URL` - Default frontend URL (https://www.viddhakarma.com)

### Database Configuration
- `DATABASE_URL` - Main database connection string
- `DIRECT_URL` - Direct database connection string
- `DATABASE_SQL_INJECTION_PREVENTION_ENABLED` - SQL injection prevention (true)
- `DATABASE_ROW_LEVEL_SECURITY_ENABLED` - Row-level security (true)
- `DATABASE_DATA_MASKING_ENABLED` - Data masking (true)
- `DATABASE_RATE_LIMITING_ENABLED` - Rate limiting (true)
- `DATABASE_READ_REPLICAS_ENABLED` - Read replicas (false)
- `DATABASE_READ_REPLICAS_STRATEGY` - Replica strategy (round-robin)
- `DATABASE_READ_REPLICAS_URLS` - Replica URLs (comma-separated)

### Cache Configuration
- `CACHE_ENABLED` - Cache enabled (true)
- `CACHE_PROVIDER` - Cache provider (dragonfly)
- `DRAGONFLY_ENABLED` - Dragonfly enabled (true)
- `DRAGONFLY_HOST` - Dragonfly host (dragonfly)
- `DRAGONFLY_PORT` - Dragonfly port (6379)
- `DRAGONFLY_KEY_PREFIX` - Key prefix (healthcare:)
- `DRAGONFLY_PASSWORD` - Dragonfly password (optional)
- `REDIS_HOST` - Redis host (redis)
- `REDIS_PORT` - Redis port (6379)
- `REDIS_TTL` - Redis TTL (7200)
- `REDIS_PREFIX` - Redis prefix (healthcare:)
- `REDIS_ENABLED` - Redis enabled (false)
- `REDIS_PASSWORD` - Redis password (optional)

### JWT & Session Configuration
- `JWT_SECRET` - JWT secret key (min 32 chars)
- `JWT_EXPIRATION` - JWT expiration (24h)
- `JWT_ACCESS_EXPIRES_IN` - Access token expiration (24h)
- `JWT_REFRESH_EXPIRES_IN` - Refresh token expiration (7d)
- `JWT_REFRESH_SECRET` - JWT refresh secret (min 32 chars)
- `SESSION_SECRET` - Session secret (min 32 chars)
- `SESSION_TIMEOUT` - Session timeout (86400)
- `SESSION_SECURE_COOKIES` - Secure cookies (true)
- `SESSION_SAME_SITE` - Same site policy (strict)
- `COOKIE_SECRET` - Cookie secret (min 32 chars)

### CORS Configuration
- `CORS_ORIGIN` - Allowed origins (comma-separated, no spaces)
  - **IMPORTANT**: Must include ALL clinic frontend URLs
  - **Single Backend**: ONE backend API serves all these frontends
  - Example: `https://clinic1.viddhakarma.com,https://clinic2.viddhakarma.com,https://www.viddhakarma.com`
- `CORS_CREDENTIALS` - CORS credentials (true)
- `CORS_METHODS` - Allowed methods (GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS)

### Email Configuration (ZeptoMail)
- `EMAIL_PROVIDER` - Email provider (zeptomail)
- `ZEPTOMAIL_ENABLED` - ZeptoMail enabled (true)
- `ZEPTOMAIL_SEND_MAIL_TOKEN` - ZeptoMail send mail token
- `ZEPTOMAIL_FROM_EMAIL` - Default from email
- `ZEPTOMAIL_FROM_NAME` - Default from name
- `ZEPTOMAIL_BOUNCE_ADDRESS` - Bounce address
- `ZEPTOMAIL_API_BASE_URL` - API base URL (https://api.zeptomail.com/v1.1)

### WhatsApp Configuration
- `WHATSAPP_ENABLED` - WhatsApp enabled (false)
- `WHATSAPP_API_URL` - WhatsApp API URL (https://graph.facebook.com/v17.0)
- `WHATSAPP_API_KEY` - WhatsApp API key
- `WHATSAPP_PHONE_NUMBER_ID` - Phone number ID
- `WHATSAPP_BUSINESS_ACCOUNT_ID` - Business account ID
- `WHATSAPP_OTP_TEMPLATE_ID` - OTP template ID
- `WHATSAPP_APPOINTMENT_TEMPLATE_ID` - Appointment template ID
- `WHATSAPP_PRESCRIPTION_TEMPLATE_ID` - Prescription template ID

### Video Configuration (OpenVidu)
- `VIDEO_ENABLED` - Video enabled (true)
- `VIDEO_PROVIDER` - Video provider (openvidu)
- `OPENVIDU_URL` - OpenVidu URL (https://video.ishswami.in)
- `OPENVIDU_SECRET` - OpenVidu secret
- `OPENVIDU_DOMAIN` - OpenVidu domain (video.ishswami.in)
- `OPENVIDU_WEBHOOK_ENABLED` - Webhook enabled (false)
- `OPENVIDU_WEBHOOK_ENDPOINT` - Webhook endpoint
- `OPENVIDU_WEBHOOK_EVENTS` - Webhook events (comma-separated)

### Firebase Configuration
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_PRIVATE_KEY` - Firebase private key (with newlines)
- `FIREBASE_CLIENT_EMAIL` - Firebase client email
- `FIREBASE_DATABASE_URL` - Firebase database URL
- `FIREBASE_VAPID_KEY` - Firebase VAPID key

### Social Auth Configuration
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - Google redirect URI
- `FACEBOOK_APP_ID` - Facebook app ID
- `FACEBOOK_APP_SECRET` - Facebook app secret
- `APPLE_CLIENT_ID` - Apple client ID
- `APPLE_CLIENT_SECRET` - Apple client secret

### S3 Storage Configuration
- `S3_ENABLED` - S3 enabled (true)
- `S3_PROVIDER` - S3 provider (contabo)
- `S3_ENDPOINT` - S3 endpoint (https://eu2.contabostorage.com)
- `S3_REGION` - S3 region (eu-central-1)
- `S3_BUCKET` - S3 bucket name
- `S3_ACCESS_KEY_ID` - S3 access key ID
- `S3_SECRET_ACCESS_KEY` - S3 secret access key
- `S3_FORCE_PATH_STYLE` - Force path style (true)
- `S3_PUBLIC_URL_EXPIRATION` - URL expiration (3600)
- `CDN_URL` - CDN URL (optional)

### Other Configuration
- `PRISMA_SCHEMA_PATH` - Prisma schema path
- `LOG_LEVEL` - Log level (info)
- `ENABLE_AUDIT_LOGS` - Audit logs enabled (true)
- `RATE_LIMIT_ENABLED` - Rate limit enabled (true)
- `RATE_LIMIT_TTL` - Rate limit TTL (60)
- `RATE_LIMIT_MAX` - Rate limit max (100)
- `API_RATE_LIMIT` - API rate limit (500)
- `AUTH_RATE_LIMIT` - Auth rate limit (30)
- `HEAVY_RATE_LIMIT` - Heavy rate limit (50)
- `USER_RATE_LIMIT` - User rate limit (200)
- `HEALTH_RATE_LIMIT` - Health rate limit (1000)
- `MAX_AUTH_ATTEMPTS` - Max auth attempts (10)
- `AUTH_ATTEMPT_WINDOW` - Auth attempt window (3600)
- `MAX_CONCURRENT_SESSIONS` - Max concurrent sessions (20)
- `SESSION_INACTIVITY_THRESHOLD` - Session inactivity threshold (1800)
- `SECURITY_RATE_LIMIT` - Security rate limit (true)
- `SECURITY_RATE_LIMIT_MAX` - Security rate limit max (500)
- `SECURITY_RATE_LIMIT_WINDOW_MS` - Security rate limit window (30000)
- `TRUST_PROXY` - Trust proxy (1)
- `SWAGGER_URL` - Swagger URL (/docs)
- `BULL_BOARD_URL` - Bull board URL (/queue-dashboard)
- `SOCKET_URL` - Socket URL (/socket.io)
- `PRISMA_STUDIO_URL` - Prisma Studio URL (/prisma)
- `PGADMIN_URL` - PgAdmin URL (/pgadmin)
- `DOCKER_ENV` - Docker environment (true)
- `DOCKER_NETWORK` - Docker network (app-network)

### Deployment Configuration
- `SSH_PRIVATE_KEY` - SSH private key for server access
- `SERVER_HOST` - Production server host
- `SERVER_USER` - Production server user
- `SERVER_DEPLOY_PATH` - Deployment path (/opt/healthcare-backend)

---

## 🏥 Clinic-Specific Secrets

**Architecture Note:** These are clinic-specific configurations for a SINGLE backend API. Only clinic-related data and credentials differ. All clinics share the same backend infrastructure.

Each clinic can have separate configuration using the pattern: `CLINIC_{SANITIZED_CLINIC_NAME}_{CONFIG_KEY}`

### Clinic Name Sanitization

Clinic names are automatically sanitized for environment variable names:
- Spaces → Underscores (`_`)
- Special characters → Underscores (`_`)
- Converted to UPPERCASE
- Multiple underscores collapsed to single underscore
- Leading/trailing underscores removed

**Examples:**
- `"Vishwamurti Ayurvedelay"` → `VISHWAMURTI_AYURVEDELAY`
- `"Aadesh Ayurvedalay"` → `AADESH_AYURVEDELAY`
- `"Shri Vishwamurti Ayurvedalay"` → `SHRI_VISHWAMURTI_AYURVEDALAY`

### Clinic-Specific Email Configuration

Pattern: `CLINIC_{NAME}_ZEPTOMAIL_{CONFIG_KEY}`

**Example for "Vishwamurti Ayurvedelay":**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_ZEPTOMAIL_SEND_MAIL_TOKEN`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_ZEPTOMAIL_FROM_EMAIL`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_ZEPTOMAIL_FROM_NAME`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_ZEPTOMAIL_BOUNCE_ADDRESS`

### Clinic-Specific WhatsApp Configuration

Pattern: `CLINIC_{NAME}_WHATSAPP_{CONFIG_KEY}`

**Example for "Vishwamurti Ayurvedelay":**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_API_KEY`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_PHONE_NUMBER_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_OTP_TEMPLATE_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_APPOINTMENT_TEMPLATE_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_WHATSAPP_PRESCRIPTION_TEMPLATE_ID`

### Clinic-Specific SMS Configuration

Pattern: `CLINIC_{NAME}_SMS_{CONFIG_KEY}`

**Example for "Vishwamurti Ayurvedelay":**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_SMS_API_KEY`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_SMS_API_SECRET`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_SMS_FROM_NUMBER`

### Clinic-Specific Firebase Configuration

Pattern: `CLINIC_{NAME}_FIREBASE_{CONFIG_KEY}`

**Example for "Vishwamurti Ayurvedelay":**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FIREBASE_PROJECT_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FIREBASE_PRIVATE_KEY`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FIREBASE_CLIENT_EMAIL`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FIREBASE_DATABASE_URL`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FIREBASE_VAPID_KEY`

### Clinic-Specific Frontend URL

Pattern: `CLINIC_{NAME}_FRONTEND_URL`

**Example for "Vishwamurti Ayurvedelay":**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FRONTEND_URL`

**IMPORTANT:** All clinic frontend URLs must also be added to the `CORS_ORIGIN` secret (comma-separated).

### Clinic-Specific OpenVidu Configuration

Pattern: `CLINIC_{NAME}_OPENVIDU_{CONFIG_KEY}`

**Example:**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_OPENVIDU_URL`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_OPENVIDU_SECRET`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_OPENVIDU_DOMAIN`

### Clinic-Specific S3 Storage Configuration

Pattern: `CLINIC_{NAME}_S3_{CONFIG_KEY}`

**Example:**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_S3_BUCKET`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_S3_ACCESS_KEY_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_S3_SECRET_ACCESS_KEY`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_S3_ENDPOINT`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_S3_REGION`

### Clinic-Specific Social Auth Configuration

Pattern: `CLINIC_{NAME}_{PROVIDER}_{CONFIG_KEY}`

**Example for Google:**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_GOOGLE_CLIENT_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_GOOGLE_CLIENT_SECRET`

**Example for Facebook:**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FACEBOOK_APP_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_FACEBOOK_APP_SECRET`

**Example for Apple:**
- `CLINIC_VISHWAMURTI_AYURVEDELAY_APPLE_CLIENT_ID`
- `CLINIC_VISHWAMURTI_AYURVEDELAY_APPLE_CLIENT_SECRET`

---

## 📝 Secret Naming Patterns

### Pattern 1: By Clinic Name
```
CLINIC_{SANITIZED_CLINIC_NAME}_{CONFIG_KEY}
```

### Pattern 2: By App Name
```
CLINIC_{SANITIZED_APP_NAME}_{CONFIG_KEY}
```

### Pattern 3: By Subdomain
```
CLINIC_{SANITIZED_SUBDOMAIN}_{CONFIG_KEY}
```

**Priority:** Name > App Name > Subdomain > Global

---

## ➕ Adding New Clinics

### Step 1: Sanitize Clinic Name
Convert clinic name to environment variable format:
- `"New Clinic Name"` → `NEW_CLINIC_NAME`

### Step 2: Add Clinic-Specific Secrets
Add all required clinic-specific secrets to GitHub Secrets:

**Email:**
- `CLINIC_NEW_CLINIC_NAME_ZEPTOMAIL_SEND_MAIL_TOKEN`
- `CLINIC_NEW_CLINIC_NAME_ZEPTOMAIL_FROM_EMAIL`
- `CLINIC_NEW_CLINIC_NAME_ZEPTOMAIL_FROM_NAME`
- `CLINIC_NEW_CLINIC_NAME_ZEPTOMAIL_BOUNCE_ADDRESS`

**WhatsApp (if enabled):**
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_API_KEY`
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_PHONE_NUMBER_ID`
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_OTP_TEMPLATE_ID`
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_APPOINTMENT_TEMPLATE_ID`
- `CLINIC_NEW_CLINIC_NAME_WHATSAPP_PRESCRIPTION_TEMPLATE_ID`

**SMS (if enabled):**
- `CLINIC_NEW_CLINIC_NAME_SMS_API_KEY`
- `CLINIC_NEW_CLINIC_NAME_SMS_API_SECRET`
- `CLINIC_NEW_CLINIC_NAME_SMS_FROM_NUMBER`

**Firebase (if enabled):**
- `CLINIC_NEW_CLINIC_NAME_FIREBASE_PROJECT_ID`
- `CLINIC_NEW_CLINIC_NAME_FIREBASE_PRIVATE_KEY`
- `CLINIC_NEW_CLINIC_NAME_FIREBASE_CLIENT_EMAIL`
- `CLINIC_NEW_CLINIC_NAME_FIREBASE_DATABASE_URL`
- `CLINIC_NEW_CLINIC_NAME_FIREBASE_VAPID_KEY`

**Frontend URL:**
- `CLINIC_NEW_CLINIC_NAME_FRONTEND_URL`

**OpenVidu (if clinic-specific):**
- `CLINIC_NEW_CLINIC_NAME_OPENVIDU_URL`
- `CLINIC_NEW_CLINIC_NAME_OPENVIDU_SECRET`
- `CLINIC_NEW_CLINIC_NAME_OPENVIDU_DOMAIN`

**S3 Storage (if clinic-specific):**
- `CLINIC_NEW_CLINIC_NAME_S3_BUCKET`
- `CLINIC_NEW_CLINIC_NAME_S3_ACCESS_KEY_ID`
- `CLINIC_NEW_CLINIC_NAME_S3_SECRET_ACCESS_KEY`

**Social Auth (if clinic-specific):**
- `CLINIC_NEW_CLINIC_NAME_GOOGLE_CLIENT_ID`
- `CLINIC_NEW_CLINIC_NAME_GOOGLE_CLIENT_SECRET`
- `CLINIC_NEW_CLINIC_NAME_FACEBOOK_APP_ID`
- `CLINIC_NEW_CLINIC_NAME_FACEBOOK_APP_SECRET`
- `CLINIC_NEW_CLINIC_NAME_APPLE_CLIENT_ID`
- `CLINIC_NEW_CLINIC_NAME_APPLE_CLIENT_SECRET`

### Step 3: Update CORS_ORIGIN
Add the clinic's frontend URL to the `CORS_ORIGIN` secret:
```
https://existing-clinic.com,https://new-clinic.com,https://www.viddhakarma.com
```

**Note:** All these frontends connect to the SAME backend API (`api.ishswami.in`). Only clinic-specific data differs.

### Step 4: Update CI/CD Workflow
Add clinic-specific secrets to `.github/workflows/ci.yml` in the deploy job's `.env.production` file creation section.

---

## 🔄 Priority Order

Configuration is resolved in the following priority order:

1. **Database Settings** (highest priority)
   - Stored in `Clinic.settings.communicationSettings` (JSONB field)
   - Configured via API endpoints
   - Encrypted at rest

2. **Clinic-Specific Environment Variables**
   - By sanitized clinic name: `CLINIC_{NAME}_{KEY}`
   - By app name: `CLINIC_{APP_NAME}_{KEY}`
   - By subdomain: `CLINIC_{SUBDOMAIN}_{KEY}`

3. **Global Environment Variables** (fallback)
   - Default values for all clinics
   - Used when clinic-specific config not found

---

## 📚 Related Documentation

- [Environment Variables Guide](./ENVIRONMENT_VARIABLES.md)
- [Multi-Tenant Configuration](./guides/SUPERADMIN_CLINIC_MANAGEMENT.md)
- [Communication System Guide](./guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md)
- [Email Integration Guide](./guides/EMAIL_INTEGRATION_GUIDE.md)

---

## ⚠️ Important Notes

1. **Single Backend Architecture**: ONE backend API serves ALL clinics. Only clinic-related data and configurations differ. All clinics share the same database, cache, and services with automatic row-level security isolation.

2. **Secret Security**: Never commit secrets to version control. Always use GitHub Secrets.

3. **CORS Configuration**: When adding clinic-specific frontend URLs, always update `CORS_ORIGIN` to include all clinic URLs (comma-separated, no spaces). All frontends connect to the same backend API.

4. **Clinic Name Sanitization**: Ensure clinic names are sanitized correctly when creating secrets. Use the sanitization rules above.

5. **Optional Secrets**: Not all clinic-specific secrets are required. Only add secrets for features that the clinic uses.

6. **Database Override**: Clinic-specific configuration stored in the database takes precedence over environment variables.

7. **Data Isolation**: Row-level security automatically ensures each clinic only accesses their own data. No separate databases needed.

---

## 🔍 Verification

After adding clinic-specific secrets:

1. Verify secrets are added to GitHub repository settings
2. Check that clinic name sanitization matches the pattern
3. Ensure `CORS_ORIGIN` includes all clinic frontend URLs
4. Test deployment to ensure secrets are properly injected
5. Verify clinic-specific configuration is loaded correctly

---

**Last Updated:** 2024-12-19
**Version:** 1.0.0

