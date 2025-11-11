# 🔒 Security Guidelines
## 🌐 Internet-Scale Defenses (10M Users)
- Dependencies: define allowlist/banlist; automate vulnerability scanning on PRs; enforce update cadence.
- Secrets: mandatory secret scanning in CI; runtime env schema validation on boot.
- Rate Limiting: sliding window per IP/user/tenant; stricter on auth, relaxed on static.
- Bot/Abuse: WAF rules, user-agent heuristics, IP reputation, challenge/ban flows.
- DoS/Backpressure: admission control, queue buffering, shed non-critical traffic under load.
- Secrets: short-lived creds, key rotation, no secrets/PHI in logs, token binding.
- Multi-Region: failover runbooks, DNS health checks, data residency and key management per region.
- Privacy: field-level encryption for PHI; purpose-based access logging; least-privilege across services.

## 🛡️ Authentication & Authorization

### **JWT Authentication Implementation**

**Current Implementation**: The system uses `JwtAuthGuard` with Redis-backed session management and progressive lockout protection.

**Location**: `src/libs/core/guards/jwt-auth.guard.ts`

```typescript
@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Progressive lockout intervals in minutes
  private readonly LOCKOUT_INTERVALS = [10, 25, 45, 60, 360]; // 10m -> 6h
  private readonly MAX_ATTEMPTS = 10;
  private readonly MAX_CONCURRENT_SESSIONS = 5;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), context.getClass()
    ]);
    if (isPublic) return true;

    // 2. Extract and verify JWT token (supports dual verification)
    const token = this.extractTokenFromHeader(request);
    const payload = await this.verifyToken(token); // Tries basic JWT + enhanced JWT

    // 3. Check token blacklist in Redis
    if (payload.jti) {
      const isBlacklisted = await this.redisService.get(`jwt:blacklist:${payload.jti}`);
      if (isBlacklisted) throw new UnauthorizedException('Token has been revoked');
    }

    // 4. Validate session in Redis
    const sessionData = await this.validateSession(payload.sub, request);

    // 5. Check concurrent sessions limit
    await this.checkConcurrentSessions(payload.sub);

    // 6. Update session activity
    await this.updateSessionData(payload.sub, sessionData, request);

    request.user = payload;
    return true;
  }
}
```

**Key Features**:
- **Dual JWT Verification**: Uses both `JwtService` and `JwtAuthService.verifyEnhancedToken()` for compatibility
- **Token Blacklist**: Redis-based revoked token tracking (`jwt:blacklist:{jti}`)
- **Session Validation**: Redis-backed session with device fingerprinting (`session:{userId}:{sessionId}`)
- **Progressive Lockout**: 10m → 25m → 45m → 1h → 6h based on failed attempts
- **Concurrent Session Limit**: Maximum 5 active sessions per user
- **Security Event Tracking**: 30-day retention of auth failures in Redis (`security:events:{identifier}`)

### **Role-Based Access Control (RBAC)**

**Current Implementation**: The system uses `RolesGuard` with healthcare-specific roles from Prisma schema.

**Location**: `src/libs/core/guards/roles.guard.ts`

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get required roles from @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true; // No role requirement
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;

    // Check if user has any of the required roles
    return requiredRoles.some((role) => user?.role?.includes(role));
  }
}
```

**Prisma Role Enum** (from `schema.prisma`):
```prisma
enum Role {
  SUPER_ADMIN
  CLINIC_ADMIN
  DOCTOR
  PATIENT
  RECEPTIONIST
  PHARMACIST
  THERAPIST
  LAB_TECHNICIAN
  FINANCE_BILLING
  SUPPORT_STAFF
  NURSE
  COUNSELOR
}
```

**Usage Pattern**:
```typescript
// Decorator in src/libs/core/decorators/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// Controller example
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  @Post()
  @Roles(Role.DOCTOR, Role.RECEPTIONIST)
  async create(@Body() createDto: CreateAppointmentDto) {
    // Only doctors and receptionists can create appointments
  }

  @Get()
  @Roles(Role.DOCTOR, Role.PATIENT, Role.RECEPTIONIST)
  async findAll() {
    // Multiple roles can access this endpoint
  }
}
```

### **Clinic Isolation Guard**

**Location**: `src/libs/core/guards/clinic.guard.ts`

Ensures multi-tenant data isolation by validating clinic access:

```typescript
@Injectable()
export class ClinicGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Determine if route requires clinic isolation
    const isClinicRoute = this.isClinicRoute(context);
    if (!isClinicRoute) return true;

    // 2. Extract clinic ID from multiple sources (priority order)
    const clinicId = this.extractClinicId(request); // Headers → Query → JWT → Params → Body
    if (!clinicId) {
      throw new ForbiddenException('Clinic ID is required');
    }

    // 3. Validate clinic access using ClinicIsolationService
    const clinicResult = await this.clinicIsolationService.validateClinicAccess(
      request.user?.sub || request.user?.id,
      clinicId
    );

    if (!clinicResult.success) {
      throw new ForbiddenException(`Clinic access denied: ${clinicResult.error}`);
    }

    // 4. Set clinic context for downstream use
    request.clinicId = clinicId;
    request.clinicContext = clinicResult.clinicContext;

    return true;
  }

  private isClinicRoute(context: ExecutionContext): boolean {
    // Check patterns: /appointments/, /clinics/, /doctors/, /patients/, /queue/
    const clinicRoutePatterns = [
      /\/appointments\//, /\/clinics\//, /\/doctors\//,
      /\/locations\//, /\/patients\//, /\/queue\//, /\/prescriptions\//
    ];
    return clinicRoutePatterns.some(pattern => pattern.test(request.url));
  }
}
```

**Clinic ID Extraction Priority**:
1. `x-clinic-id` or `clinic-id` headers
2. `clinicId` or `clinic_id` query parameters
3. `clinicId` from JWT token payload
4. `clinicId` from route parameters
5. `clinicId` from request body

## 🔐 Input Validation & Sanitization

### **Comprehensive DTO Validation**
```typescript
export class CreateUserDto {
  @ApiProperty({ description: 'User full name' })
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  @Matches(/^[a-zA-Z\s]+$/, { message: 'Name can only contain letters and spaces' })
  name: string;

  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  @MaxLength(100)
  email: string;

  @ApiProperty({ description: 'Strong password' })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
  })
  password: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone?: string;

  @ApiProperty({ description: 'User role' })
  @IsEnum(UserRole)
  role: UserRole;
}
```

### **Custom Validation Decorators**
```typescript
// Medical record number validator
export function IsMedicalRecordNumber(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isMedicalRecordNumber',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return typeof value === 'string' && /^MR\d{8}$/.test(value);
        },
        defaultMessage() {
          return 'Medical record number must be in format MR12345678';
        }
      }
    });
  };
}

// Usage
export class CreateMedicalRecordDto {
  @IsMedicalRecordNumber()
  recordNumber: string;
}
```

## 🔒 Data Protection & Encryption

### **Sensitive Data Encryption**
```typescript
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: Buffer;

  constructor(private configService: ConfigService) {
    this.secretKey = Buffer.from(
      this.configService.get<string>('ENCRYPTION_KEY'),
      'hex'
    );
  }

  encrypt(text: string): EncryptedData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.secretKey);
    cipher.setAAD(Buffer.from('healthcare-app'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decrypt(encryptedData: EncryptedData): string {
    const decipher = crypto.createDecipher(this.algorithm, this.secretKey);
    decipher.setAAD(Buffer.from('healthcare-app'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

// Usage for sensitive medical data
@Injectable()
export class MedicalRecordService {
  constructor(
    private readonly encryptionService: EncryptionService,
    private readonly prisma: PrismaService
  ) {}

  async createMedicalRecord(data: CreateMedicalRecordDto): Promise<MedicalRecord> {
    // Encrypt sensitive fields
    const encryptedDiagnosis = this.encryptionService.encrypt(data.diagnosis);
    const encryptedTreatment = this.encryptionService.encrypt(data.treatment);

    return this.prisma.healthcare.medicalRecord.create({
      data: {
        ...data,
        diagnosis: JSON.stringify(encryptedDiagnosis),
        treatment: JSON.stringify(encryptedTreatment)
      }
    });
  }

  async getMedicalRecord(id: string): Promise<MedicalRecord> {
    const record = await this.prisma.healthcare.medicalRecord.findUnique({
      where: { id }
    });

    if (record) {
      // Decrypt sensitive fields
      const diagnosisData = JSON.parse(record.diagnosis);
      const treatmentData = JSON.parse(record.treatment);

      record.diagnosis = this.encryptionService.decrypt(diagnosisData);
      record.treatment = this.encryptionService.decrypt(treatmentData);
    }

    return record;
  }
}
```

## 🛡️ Security Middleware & Headers

### **Security Headers Configuration**

**Current Implementation**: Fastify Helmet with CSP, CORS, and production optimizations.

**Location**: `src/main.ts` (lines 796-840)

```typescript
// Security Headers (Helmet)
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", "'unsafe-inline'", "'unsafe-eval'",
        "https://accounts.google.com",
        "https://apis.google.com",
        "https://www.googleapis.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'",
        "http://localhost:3000",
        "https://ishswami.in",
        "https://api.ishswami.in",
        "wss://api.ishswami.in",
        "https://accounts.google.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://accounts.google.com", "http://localhost:3000"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "cross-origin" }
});

// CORS Configuration
app.enableCors({
  origin: process.env.NODE_ENV === 'production'
    ? [
        "https://ishswami.in",
        "https://www.ishswami.in",
        /\.ishswami\.in$/,
        "http://localhost:3000", // Allow local dev frontend
        "https://accounts.google.com"
      ]
    : [
        "http://localhost:3000",
        "http://localhost:8088",
        "http://localhost:5050",
        "https://accounts.google.com"
      ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Session-ID', 'X-Clinic-ID',
    'Origin', 'Accept', 'X-Requested-With',
    'Access-Control-Request-Method', 'Access-Control-Request-Headers',
    'X-Client-Data', 'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest'
  ],
  exposedHeaders: ['Set-Cookie', 'Authorization'],
  maxAge: 86400 // 24 hours
});
```

### **Rate Limiting**

**Current Implementation**: Redis-based rate limiting with sliding window algorithm.

**Location**: `src/libs/utils/rate-limit/rate-limit.service.ts`

```typescript
@Injectable()
export class RateLimitService {
  async isRateLimited(
    identifier: string,
    type: string = 'api'
  ): Promise<{ limited: boolean; remaining: number }> {
    // Skip in development mode
    if (this.cacheService.isDevelopmentMode) {
      return { limited: false, remaining: Number.MAX_SAFE_INTEGER };
    }

    const { maxRequests, windowMs } = this.config.getLimits(type);
    const key = `ratelimit:${type}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // 1. Remove old entries outside the current window (Redis Sorted Set)
      await this.cacheService.zremrangebyscore(key, 0, windowStart);

      // 2. Add current request with timestamp as score
      await this.cacheService.zadd(key, now, `${now}`);

      // 3. Get current count in window
      const requestCount = await this.cacheService.zcard(key);

      // 4. Set expiry on the key
      await this.cacheService.expire(key, Math.ceil(windowMs / 1000));

      // 5. Track metrics for monitoring
      await this.trackMetrics(type, requestCount > maxRequests);

      return {
        limited: requestCount > maxRequests,
        remaining: Math.max(0, maxRequests - requestCount)
      };
    } catch (error) {
      // Fail open in case of Redis errors
      return { limited: false, remaining: maxRequests };
    }
  }

  // Get rate limit metrics for last N minutes
  async getRateLimitMetrics(type: string, minutes: number = 5): Promise<{
    total: number;
    limited: number;
    limitedPercentage: number;
  }> {
    // Implementation details in file...
  }
}
```

**Fastify Rate Limiting** (configured in `main.ts`):
```typescript
await app.register(fastifyRateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  redis: {
    host: configService.get('REDIS_HOST'),
    port: configService.get('REDIS_PORT'),
    password: configService.get('REDIS_PASSWORD')
  },
  keyGenerator: (request) => {
    return `${request.ip}:${request.headers?.['user-agent'] || 'unknown'}`;
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true
  }
});
```

## 🔐 Session Management

**Current Implementation**: Enterprise-grade Redis-based session management with distributed partitioning for 1M+ users.

**Location**: `src/libs/core/session/session-management.service.ts`

### **Session Service Implementation**
```typescript
@Injectable()
export class SessionManagementService implements OnModuleInit {
  private readonly SESSION_PREFIX = 'session:';
  private readonly USER_SESSIONS_PREFIX = 'user_sessions:';
  private readonly BLACKLIST_PREFIX = 'blacklist:';

  private config: SessionConfig = {
    maxSessionsPerUser: 5,
    sessionTimeout: 24 * 60 * 60, // 24 hours
    extendOnActivity: true,
    distributed: true,
    partitions: 16 // For horizontal scaling
  };

  /**
   * Create new session with automatic partition assignment
   */
  async createSession(createSessionDto: CreateSessionDto): Promise<SessionData> {
    const sessionId = this.generateSessionId(); // crypto.randomBytes(32)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTimeout * 1000);

    const sessionData: SessionData = {
      sessionId,
      userId: createSessionDto.userId,
      clinicId: createSessionDto.clinicId,
      userAgent: createSessionDto.userAgent,
      ipAddress: createSessionDto.ipAddress,
      deviceId: createSessionDto.deviceId,
      loginTime: now,
      lastActivity: now,
      expiresAt,
      isActive: true,
      metadata: createSessionDto.metadata || {}
    };

    // 1. Enforce session limits (auto-cleanup oldest sessions)
    await this.enforceSessionLimits(createSessionDto.userId);

    // 2. Store session with distributed partitioning
    await this.storeSession(sessionData);

    // 3. Add to user sessions index (Redis Set)
    await this.addUserSession(createSessionDto.userId, sessionId);

    // 4. Log security event
    await this.logging.log(LogType.SECURITY, LogLevel.INFO, 'Session created', ...);

    return sessionData;
  }

  /**
   * Get session with blacklist and expiry checks
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const sessionKey = this.getSessionKey(sessionId);
    const sessionData = await this.redis.get<SessionData>(sessionKey);

    if (!sessionData) return null;

    // Check expiry
    if (new Date() > new Date(sessionData.expiresAt)) {
      await this.invalidateSession(sessionId);
      return null;
    }

    // Check blacklist
    if (await this.isSessionBlacklisted(sessionId)) {
      return null;
    }

    return sessionData;
  }

  /**
   * Update session activity with auto-extension
   */
  async updateSessionActivity(sessionId: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    const now = new Date();
    session.lastActivity = now;

    // Extend session if configured
    if (this.config.extendOnActivity) {
      session.expiresAt = new Date(now.getTime() + this.config.sessionTimeout * 1000);
    }

    if (metadata) {
      session.metadata = { ...session.metadata, ...metadata };
    }

    await this.storeSession(session);
    return true;
  }

  /**
   * Revoke all user sessions except current
   */
  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const sessions = await this.getUserSessions(userId);
    let revokedCount = 0;

    for (const session of sessions) {
      if (exceptSessionId && session.sessionId === exceptSessionId) {
        continue;
      }
      if (await this.invalidateSession(session.sessionId)) {
        revokedCount++;
      }
    }

    return revokedCount;
  }

  /**
   * Detect suspicious sessions (auto-runs every 30 minutes)
   */
  async detectSuspiciousSessions(): Promise<{
    suspicious: SessionData[];
    reasons: Record<string, string[]>;
  }> {
    // Checks:
    // 1. Multiple concurrent sessions from different IPs (> 3)
    // 2. Unusual user agent patterns (bots, crawlers)
    // 3. Long inactive sessions (> 24 hours)
    // 4. Rapid geographical location changes
  }

  /**
   * Distributed partition key generation
   */
  private getSessionKey(sessionId: string): string {
    if (this.config.distributed) {
      const partition = this.getPartition(sessionId); // MD5 hash % partitions
      return `${this.SESSION_PREFIX}${partition}:${sessionId}`;
    }
    return `${this.SESSION_PREFIX}${sessionId}`;
  }

  /**
   * Auto-cleanup jobs (runs every hour)
   */
  private setupCleanupJobs(): void {
    // Cleanup expired sessions every hour
    setInterval(async () => {
      await this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);

    // Check for suspicious sessions every 30 minutes
    setInterval(async () => {
      const { suspicious } = await this.detectSuspiciousSessions();
      if (suspicious.length > 0) {
        this.logger.warn(`Detected ${suspicious.length} suspicious sessions`);
      }
    }, 30 * 60 * 1000);
  }
}
```

**Key Features**:
- **Distributed Partitioning**: 16 partitions using MD5 hash for horizontal scaling
- **Session Limits**: Maximum 5 sessions per user (auto-cleanup oldest)
- **Blacklist System**: Redis-based session blacklisting on invalidation
- **Auto-Cleanup**: Hourly expired session cleanup + suspicious session detection
- **Activity Extension**: Auto-extends sessions on activity (configurable)
- **Security Monitoring**: 10-minute statistics logging, suspicious session detection
- **Clinic Isolation**: Multi-tenant session support with clinic context

## 🔄 Event-Driven Security

**MANDATORY**: Always use `EventService` from `@infrastructure/events` for security-related events.

```typescript
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@core/types';

@Injectable()
export class SecurityService {
  constructor(private readonly eventService: EventService) {}

  async logSecurityEvent(eventType: string, details: Record<string, unknown>): Promise<void> {
    await this.eventService.emitEnterprise(eventType, {
      eventId: `security-${Date.now()}`,
      eventType,
      category: EventCategory.SECURITY,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'SecurityService',
      version: '1.0.0',
      payload: details
    });
  }
}
```

## 🔍 Audit Logging

**Current Implementation**: Uses enterprise `LoggingService` with structured logging instead of separate audit tables.

**Location**: `src/libs/infrastructure/logging/logging.service.ts`

**Prisma Schema**: AuditLog model exists in schema for compliance tracking:
```prisma
model AuditLog {
  id          String   @id @default(uuid())
  userId      String?
  action      String
  resource    String
  resourceId  String?
  details     Json?
  ipAddress   String?
  userAgent   String?
  clinicId    String?
  timestamp   DateTime @default(now())
  createdAt   DateTime @default(now())

  user        User?    @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([action])
  @@index([resource])
  @@index([clinicId])
  @@index([timestamp])
  @@map("audit_logs")
}
```

**Actual Implementation** - Uses `LoggingService`:
```typescript
// Security logging in JwtAuthGuard
await this.trackSecurityEvent(identifier, 'AUTHENTICATION_FAILURE', {
  error: error.message,
  path: request.raw?.url || '',
  method: request.method
});

private async trackSecurityEvent(
  identifier: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<void> {
  const timestamp = new Date().toISOString();
  const event = {
    timestamp,
    eventType,
    identifier,
    details
  };

  // Store in Redis for fast access
  await this.redisService.rPush(`security:events:${identifier}`, JSON.stringify(event));

  // Trim old events (keep last 1000)
  await this.redisService.lTrim(`security:events:${identifier}`, -1000, -1);

  // Set expiry for events list (30 days)
  await this.redisService.expire(`security:events:${identifier}`, 30 * 24 * 60 * 60);
}

// Security logging in SessionManagementService
await this.logging.log(
  LogType.SECURITY,
  LogLevel.INFO,
  'Session created',
  'SessionManagementService',
  {
    sessionId,
    userId: createSessionDto.userId,
    clinicId: createSessionDto.clinicId,
    ipAddress: createSessionDto.ipAddress,
    userAgent: createSessionDto.userAgent
  }
);

await this.logging.log(
  LogType.SECURITY,
  LogLevel.WARN,
  'All user sessions revoked',
  'SessionManagementService',
  { userId, revokedCount, exceptSessionId }
);
```

**LoggingService Features**:
- **Structured Logging**: JSON-formatted logs with full context
- **Log Types**: AUTH, SECURITY, SYSTEM, ERROR, DATABASE, CACHE, QUEUE
- **Multiple Outputs**: Database + File + Console
- **Automatic Context**: Request ID, user ID, clinic ID, IP address
- **Search & Filter**: Database queries for compliance audits
- **Retention**: Configurable retention periods

## 🔌 WebSocket Security

**Current Implementation**: JWT-based WebSocket authentication middleware.

**Location**: `src/libs/communication/socket/socket-auth.middleware.ts`

```typescript
@Injectable()
export class SocketAuthMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * Validate WebSocket connection with JWT token or session
   */
  async validateConnection(client: Socket): Promise<AuthenticatedUser> {
    // 1. Try session-based auth first (if available)
    const sessionUser = this.extractFromSession(client);
    if (sessionUser) {
      return sessionUser;
    }

    // 2. Fall back to JWT token auth
    const token = this.extractToken(client);
    if (!token) {
      throw new Error('Authentication required - no token or session');
    }

    // 3. Verify JWT token
    const payload = await this.jwtService.verifyAsync(token);

    // 4. Extract user data from token
    const user: AuthenticatedUser = {
      userId: payload.sub || payload.userId || payload.id,
      clinicId: payload.clinicId,
      role: payload.role,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName
    };

    if (!user.userId) {
      throw new Error('Invalid token - missing user ID');
    }

    return user;
  }

  /**
   * Extract JWT token from socket connection (multiple methods)
   */
  private extractToken(client: Socket): string | null {
    // Priority order:
    // 1. Auth object (socket.io v4 recommended way)
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token;
    }

    // 2. Query parameters (fallback)
    if (client.handshake.query?.token) {
      return client.handshake.query.token as string;
    }

    // 3. Authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, '');
    }

    return null;
  }

  /**
   * Validate token without throwing (for optional auth)
   */
  async validateOptional(client: Socket): Promise<AuthenticatedUser | null> {
    try {
      return await this.validateConnection(client);
    } catch (error) {
      return null; // Allow anonymous connection
    }
  }
}
```

**WebSocket Configuration** (`main.ts`):
```typescript
createIOServer(port: number, options?: Record<string, unknown>) {
  const server = super.createIOServer(port, {
    ...options,
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? process.env.CORS_ORIGIN?.split(',') || ['https://ishswami.in']
        : '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e6
  });

  // Redis adapter for distributed WebSocket (horizontal scaling)
  server.adapter(createAdapter(pubClient, subClient));

  return server;
}
```

**Key Features**:
- **Dual Authentication**: Session-based + JWT token support
- **Multiple Token Sources**: Auth object, query params, authorization header
- **Optional Auth**: Supports anonymous connections where needed
- **Redis Adapter**: Distributed WebSocket across multiple instances
- **CORS Protection**: Environment-specific origin validation
- **Connection Timeout**: 45s timeout with 60s ping timeout

## 🚫 Security Anti-Patterns

### **❌ Don't Do This**
```typescript
// Don't store passwords in plain text
const user = { password: 'plaintext123' };

// Don't use weak JWT secrets
const secret = 'secret';

// Don't expose sensitive data in responses
return {
  user: {
    id: user.id,
    password: user.password, // Exposed!
    ssn: user.ssn // Exposed!
  }
};

// Don't skip input validation
@Post()
async create(@Body() data: any) { // No validation

// Don't use SQL injection vulnerable queries
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

### **✅ Do This Instead**
```typescript
// Hash passwords properly
const hashedPassword = await bcrypt.hash(password, 12);

// Use strong JWT secrets
const secret = process.env.JWT_SECRET; // 256-bit random string

// Use EventService for security events
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@core/types';

await this.eventService.emitEnterprise('security.breach', {
  eventId: `security-${Date.now()}`,
  eventType: 'security.breach',
  category: EventCategory.SECURITY,
  priority: EventPriority.CRITICAL,
  timestamp: new Date().toISOString(),
  source: 'SecurityService',
  version: '1.0.0',
  payload: { details }
});

// Sanitize response data
return {
  user: {
    id: user.id,
    name: user.name,
    email: user.email
    // No sensitive fields
  }
};

// Always validate input
@Post()
async create(@Body() createUserDto: CreateUserDto) { // Validated DTO

// Use parameterized queries
const user = await prisma.user.findUnique({ where: { id: userId } });
```

---

**💡 Security is paramount in healthcare applications. Always follow HIPAA compliance requirements and implement defense-in-depth strategies.**

**Last Updated**: December 2024
