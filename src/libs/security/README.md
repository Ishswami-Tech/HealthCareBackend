# Security Module

**Purpose:** Enterprise-grade security middleware and utilities
**Location:** `src/libs/security`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { SecurityConfigService } from '@security';
import { RateLimitService } from '@security/rate-limit';

// Configure security middleware (in main.ts)
const securityConfig = app.get(SecurityConfigService);
await securityConfig.configureProductionSecurity(app, logger);
securityConfig.configureCORS(app);
securityConfig.addCorsPreflightHandler(app);
securityConfig.addBotDetectionHook(app);

// Programmatic rate limiting (in services)
@Injectable()
export class MyService {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async sensitiveOperation(userId: string) {
    const result = await this.rateLimitService.checkRateLimit(`user:${userId}`, {
      windowMs: 60000,  // 1 minute
      max: 10,          // 10 requests
    });

    if (!result.allowed) {
      throw new TooManyRequestsException('Rate limit exceeded');
    }

    // Proceed with operation
  }
}
```

---

## Key Features

- ✅ **Global Rate Limiting** - Fastify @fastify/rate-limit plugin (Redis-backed)
- ✅ **Programmatic Rate Limiting** - RateLimitService for custom logic
- ✅ **Security Headers** - Helmet with CSP (Swagger UI compatible)
- ✅ **CORS Configuration** - Multi-origin support with credentials
- ✅ **Bot Detection** - Automatic bot scan filtering
- ✅ **Compression** - Gzip, Deflate, Brotli support
- ✅ **Multipart Handling** - File upload protection (50MB limit)
- ✅ **Cookie & Session** - Secure cookie and session management
- ✅ **Multiple Key Strategies** - IP, user, auth-based rate limiting

---

## Security Components (2)

1. **SecurityConfigService** - Global security middleware configuration
   - Rate limiting (global Fastify plugin)
   - CORS (Cross-Origin Resource Sharing)
   - Helmet (security headers with CSP)
   - Bot detection hooks
   - Compression (Gzip, Brotli)
   - Multipart form handling
   - Cookie & session management

2. **RateLimitService** - Programmatic rate limiting service
   - Redis-based sliding window
   - Custom key generation
   - Per-user, per-IP, per-endpoint limits
   - Rate limit reset

---

## Global Rate Limiting

Automatic rate limiting on all requests:

```typescript
// main.ts - Configure global rate limiting
const securityConfig = app.get(SecurityConfigService);
await securityConfig.configureProductionSecurity(app, logger);

// Environment configuration
RATE_LIMIT_MAX=100          // 100 requests
RATE_LIMIT_WINDOW=1 minute  // per 1 minute window
REDIS_HOST=localhost        // Redis for rate limit storage
REDIS_PORT=6379
```

**Global Rate Limit Behavior:**
- Applies to all endpoints automatically
- Key: `${ip}:${userAgent}`
- Response headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`
- 429 response when exceeded: `{ statusCode: 429, error: 'Too Many Requests', message: '...', retryAfter: 60 }`

---

## Programmatic Rate Limiting

Custom rate limiting in services/controllers:

```typescript
import { RateLimitService } from '@security/rate-limit';

@Injectable()
export class AuthService {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async login(email: string, password: string) {
    // Rate limit by email (prevent brute force)
    const result = await this.rateLimitService.checkRateLimit(
      `auth:${email}`,
      {
        windowMs: 60000,  // 1 minute
        max: 5,           // 5 login attempts
      }
    );

    if (!result.allowed) {
      throw new TooManyRequestsException(
        `Too many login attempts. Try again in ${Math.round((result.resetTime.getTime() - Date.now()) / 1000)}s`
      );
    }

    // Proceed with login
    // ...
  }
}
```

---

## Rate Limit Key Strategies

Multiple key generation strategies for different scenarios:

### 1. IP-Based (Default)

```typescript
// Rate limit by client IP
const key = this.rateLimitService.generateDefaultKey(request);
// Returns: "192.168.1.100" or "unknown"

const result = await this.rateLimitService.checkRateLimit(key, {
  windowMs: 60000,
  max: 100,
});
```

### 2. User-Based

```typescript
// Rate limit by authenticated user ID
const key = this.rateLimitService.generateUserKey(request);
// Returns: "user:12345" or falls back to IP

const result = await this.rateLimitService.checkRateLimit(key, {
  windowMs: 60000,
  max: 50, // Authenticated users get higher limits
});
```

### 3. Auth-Based (Login/Registration)

```typescript
// Rate limit by email/phone/username (for auth endpoints)
const key = this.rateLimitService.generateAuthKey(request);
// Returns: "auth:user@example.com" or falls back to IP

const result = await this.rateLimitService.checkRateLimit(key, {
  windowMs: 300000, // 5 minutes
  max: 5,           // 5 attempts
});
```

### 4. Custom Key

```typescript
// Custom rate limit key
const result = await this.rateLimitService.checkRateLimit(
  `custom:operation:${userId}`,
  {
    windowMs: 60000,
    max: 10,
  }
);
```

---

## Rate Limit Response

```typescript
interface RateLimitResult {
  allowed: boolean;     // Can proceed with request?
  remaining: number;    // Remaining requests in window
  resetTime: Date;      // When window resets
  total: number;        // Total requests allowed in window
}

const result = await this.rateLimitService.checkRateLimit(key, options);

if (!result.allowed) {
  const retryAfterSeconds = Math.round((result.resetTime.getTime() - Date.now()) / 1000);
  throw new TooManyRequestsException(
    `Rate limit exceeded. Try again in ${retryAfterSeconds}s`
  );
}

console.log(`Remaining: ${result.remaining}/${result.total}`);
```

---

## Security Headers (Helmet)

Helmet security headers with Swagger UI compatibility:

```typescript
// Configured in SecurityConfigService
{
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for Swagger UI
        "'unsafe-eval'",   // Required for Swagger UI
        "https://accounts.google.com",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for Swagger UI
        "https://fonts.googleapis.com",
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "wss://api.example.com"], // WebSocket support
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // Prevent clickjacking
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}
```

---

## CORS Configuration

Multi-origin CORS with credentials:

```typescript
// Environment configuration
CORS_ORIGIN=http://localhost:3000,https://app.example.com

// SecurityConfigService.configureCORS()
app.enableCors({
  origin: ['http://localhost:3000', 'https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Session-ID',
    'X-Clinic-ID',
    // ... more headers
  ],
  exposedHeaders: ['Set-Cookie', 'Authorization'],
  maxAge: 86400, // 24 hours
});
```

**Preflight Handler:**
- Automatic OPTIONS request handling
- Validates origin against allowed origins
- Returns CORS headers

---

## Bot Detection

Automatic bot scan filtering:

```typescript
// SecurityConfigService.addBotDetectionHook()
// Detects and blocks:
// - Common bot scan paths: /admin, /wp-, /php, /cgi-bin, /config
// - Bot user agents: bot, crawler, spider

// Returns 404 immediately without further processing
```

---

## Compression

Gzip, Deflate, Brotli compression:

```typescript
// SecurityConfigService.configureCompression()
{
  global: true,
  threshold: 1024,              // Compress responses > 1KB
  encodings: ['gzip', 'deflate', 'br'],
  brotliOptions: {
    quality: 4,                 // Balance speed/compression
    windowBits: 22,
    mode: 'text',
  },
  gzipOptions: {
    level: 6,                   // Default compression level
    windowBits: 15,
    memLevel: 8,
  },
}
```

---

## Multipart Handling

File upload protection:

```typescript
// SecurityConfigService.configureMultipart()
{
  limits: {
    fieldNameSize: 100,         // Max field name length
    fieldSize: 1000000,         // 1MB per field
    fields: 10,                 // Max 10 fields
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 5,                   // Max 5 files
    headerPairs: 2000,
  },
  attachFieldsToBody: true,
}
```

---

## Cookie & Session Management

Secure cookie and session handling:

```typescript
// Environment configuration
SESSION_SECRET=min-32-chars-secret-here
SESSION_TIMEOUT=86400          // 24 hours in seconds
SESSION_SECURE_COOKIES=true    // HTTPS only
SESSION_SAME_SITE=strict       // strict | lax | none

// SecurityConfigService.configureCookies()
await securityConfig.configureCookies(app);

// SecurityConfigService.configureSession()
await securityConfig.configureSession(app, sessionStore);
// - Uses CacheService (Redis/Dragonfly) for distributed sessions
// - 24-hour default timeout
// - Secure, HttpOnly cookies
// - SameSite: strict
```

**Session Options:**
- **Cookie Name:** `healthcare.session`
- **Secure:** true (HTTPS only in production)
- **HttpOnly:** true (no JavaScript access)
- **SameSite:** strict (CSRF protection)
- **MaxAge:** 24 hours (configurable)

---

## Usage Examples

### Rate Limit by User ID

```typescript
@Injectable()
export class NotificationService {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async sendNotification(userId: string, message: string) {
    // Limit notifications per user
    const result = await this.rateLimitService.checkRateLimit(
      `notification:${userId}`,
      {
        windowMs: 60000,  // 1 minute
        max: 10,          // 10 notifications per minute
      }
    );

    if (!result.allowed) {
      throw new TooManyRequestsException('Notification rate limit exceeded');
    }

    // Send notification
    await this.communicationService.send({ ... });
  }
}
```

### Reset Rate Limit

```typescript
// Reset rate limit for a key (e.g., after successful login)
await this.rateLimitService.resetRateLimit(`auth:${email}`);
```

### Conditional Rate Limiting

```typescript
const result = await this.rateLimitService.checkRateLimit(key, {
  windowMs: 60000,
  max: 100,
  skipIf: (req) => {
    // Skip rate limiting for admin users
    return req.user?.role === 'SUPER_ADMIN';
  },
});
```

---

## Configuration

Environment variables:

```env
# Global rate limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
REDIS_HOST=localhost
REDIS_PORT=6379

# CORS
CORS_ORIGIN=http://localhost:3000,https://app.example.com

# Session & cookies
SESSION_SECRET=min-32-chars-secret
SESSION_TIMEOUT=86400
SESSION_SECURE_COOKIES=true
SESSION_SAME_SITE=strict
COOKIE_SECRET=min-32-chars-secret

# Security headers
FRONTEND_URL=https://app.example.com
API_URL=https://api.example.com
```

---

## Troubleshooting

**Issue: Rate limit not working**
```typescript
// 1. Check Redis connection
// Global rate limiting uses Redis - ensure Redis is accessible

// 2. Check rate limit configuration
const rateLimitConfig = this.configService.getRateLimitConfig();
console.log(rateLimitConfig); // { max: 100, timeWindow: '1 minute' }

// 3. Check logs
// RateLimitService logs SECURITY events when rate limit is exceeded
```

**Issue: CORS errors**
```typescript
// 1. Check CORS origin configuration
CORS_ORIGIN=http://localhost:3000,https://app.example.com

// 2. Ensure credentials are enabled
// SecurityConfigService.configureCORS() sets credentials: true

// 3. Check preflight handler
// SecurityConfigService.addCorsPreflightHandler() must be called
```

**Issue: Session not persisting**
```typescript
// 1. Check session secret length (must be >= 32 chars)
SESSION_SECRET=min-32-chars-secret-here

// 2. Check session store
// Pass CacheService-backed store to configureSession()
await securityConfig.configureSession(app, sessionStore);

// 3. Check cookie configuration
SESSION_SECURE_COOKIES=true  // Use false for local HTTP
SESSION_SAME_SITE=strict
```

**Issue: Compression not working**
```typescript
// 1. Check response size (must be > 1KB threshold)
// 2. Check client Accept-Encoding header
// 3. Check compression configuration in SecurityConfigService
```

---

## Architecture

```
SecurityModule
├── SecurityConfigService (global middleware)
│   ├── configureProductionSecurity()
│   │   ├── configureCompression()
│   │   ├── configureRateLimiting() (global Fastify plugin)
│   │   ├── configureMultipart()
│   │   ├── configureHelmet()
│   │   └── configureCookies()
│   ├── configureCORS()
│   ├── configureSession()
│   ├── addCorsPreflightHandler()
│   └── addBotDetectionHook()
└── RateLimitService (programmatic)
    ├── checkRateLimit()
    ├── resetRateLimit()
    ├── generateDefaultKey() (IP-based)
    ├── generateUserKey() (user ID)
    └── generateAuthKey() (email/phone)
```

**Rate Limiting Layers:**
1. **Global Middleware** - Fastify @fastify/rate-limit plugin (all requests)
2. **Programmatic** - RateLimitService (custom logic in services/controllers)
3. **Cache-Based** - CacheService.isRateLimited() (cache-integrated)

**When to Use Each:**
- **Global Middleware** - Default rate limiting for all endpoints (IP-based)
- **RateLimitService** - Endpoint-specific or user-based rate limiting with custom keys
- **CacheService.isRateLimited()** - Cache-integrated rate limiting in services

---

## Related Documentation

- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)
- [Authentication Service](../../services/auth/README.md)
- [Cache Service](../infrastructure/cache/README.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
