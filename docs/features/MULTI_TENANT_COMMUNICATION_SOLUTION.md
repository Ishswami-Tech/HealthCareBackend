# 🏥 Multi-Tenant Communication System - Architecture & Design

## 📋 Overview

This document outlines the **architecture and design** for clinic-specific email and WhatsApp configuration in the Healthcare platform. Each clinic can use their own communication providers and credentials, supporting multiple vendors and integration flexibility.

**⚠️ Note**: This is a **DESIGN DOCUMENT ONLY**. No implementation is included. This provides the architectural blueprint for multi-tenant communication with provider flexibility.

---

## 🚨 Current Problem

### ❌ **Current Architecture (Single-Tenant)**

```
Global Configuration (Shared by ALL Clinics):
├── Email: Single SMTP/SES account
│   └── From: noreply@healthcare.com
├── WhatsApp: Single Business Account
│   └── Number: +1-XXX-GLOBAL
└── SMS: Single Twilio/SNS account
```

**Issues:**
- ❌ All emails come from same address (poor clinic branding)
- ❌ All WhatsApp messages from same number (confusing for patients)
- ❌ Cannot support clinic-specific providers (Gmail, Outlook, SendGrid, etc.)
- ❌ Cannot switch providers per clinic
- ❌ Cannot scale for 200+ clinics with different vendor preferences
- ❌ Violates multi-tenant isolation principles
- ❌ No per-clinic usage tracking or billing
- ❌ Single point of failure affects all clinics

---

## ✅ Proposed Solution (Multi-Tenant + Multi-Provider)

### 🎯 **High-Level Architecture**

```
┌──────────────────────────────────────────────────────────────────┐
│                  Business Service Layer                          │
│     (Appointments, Notifications, Billing, Auth, etc.)           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           │ Communication Request + clinicId
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              CommunicationService (Orchestrator)                  │
│  • Receives clinicId with every request                          │
│  • Validates request and recipient preferences                   │
│  • Routes to CommunicationService                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│         CommunicationService (Configuration Layer)          │
│  • Fetches clinic-specific provider configuration                │
│  • Decrypts credentials (KMS/Secrets Manager)                    │
│  • Caches config in Redis/Dragonfly (1 hour TTL)                 │
│  • Provides fallback to global/default config                    │
│  • Connection pool management per clinic                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           │ Provider-specific config
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│            Provider Adapter Layer (Strategy Pattern)             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              Email Provider Adapters                    │   │
│  │  • SMTP Adapter (Gmail, Outlook, Custom SMTP)          │   │
│  │  • AWS SES Adapter                                      │   │
│  │  • SendGrid Adapter                                     │   │
│  │  • Mailgun Adapter                                      │   │
│  │  • Mailtrap Adapter (Dev/Staging)                      │   │
│  │  • Postmark Adapter                                     │   │
│  │  • [Extensible: Add new providers easily]              │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │           WhatsApp Provider Adapters                    │   │
│  │  • Meta Business API Adapter (Official)                │   │
│  │  • Twilio WhatsApp Adapter                             │   │
│  │  • MessageBird WhatsApp Adapter                        │   │
│  │  • Vonage WhatsApp Adapter                             │   │
│  │  • [Extensible: Add new providers easily]              │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │              SMS Provider Adapters                      │   │
│  │  • Twilio SMS Adapter                                  │   │
│  │  • AWS SNS Adapter                                      │   │
│  │  • MessageBird SMS Adapter                             │   │
│  │  • Vonage SMS Adapter                                   │   │
│  │  • [Extensible: Add new providers easily]              │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           │ API Calls to External Services
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                 External Provider Services                        │
│  • Gmail SMTP, AWS SES, SendGrid, Mailgun, Postmark             │
│  • Meta WhatsApp, Twilio, MessageBird, Vonage                   │
│  • Multiple SMS providers                                        │
└──────────────────────────────────────────────────────────────────┘
```

### 🎨 **Key Design Principles**

1. **Provider Agnostic**: Support ANY email/WhatsApp/SMS provider
2. **Plugin Architecture**: Easy to add new providers without changing core logic
3. **Strategy Pattern**: Runtime provider selection based on clinic config
4. **Graceful Degradation**: Fallback to global config or alternative providers
5. **Connection Pooling**: Reuse connections per clinic per provider
6. **Configuration Flexibility**: Each clinic chooses their own provider stack

---

## 🏛️ SOLID, DRY, KISS Principles & Enterprise Architecture

### **🎯 SOLID Principles Application**

#### **1. Single Responsibility Principle (SRP)**

**Each class/service has ONE reason to change:**

```
✅ GOOD: Separation of Concerns

CommunicationService
├─ Responsibility: Fetch & cache clinic communication config
├─ Changes when: Config storage or caching strategy changes
└─ Does NOT: Send emails, encrypt credentials, or manage connections

CredentialEncryptionService
├─ Responsibility: Encrypt/decrypt sensitive credentials
├─ Changes when: Encryption algorithm or key management changes
└─ Does NOT: Fetch config, validate credentials, or send messages

SMTPEmailAdapter
├─ Responsibility: Send emails via SMTP protocol
├─ Changes when: SMTP protocol implementation changes
└─ Does NOT: Decide which provider to use, cache config, or handle billing

ProviderFactory
├─ Responsibility: Instantiate provider adapters
├─ Changes when: New provider types are added
└─ Does NOT: Send messages, store config, or manage health checks

CommunicationService (Orchestrator)
├─ Responsibility: Coordinate communication requests across channels
├─ Changes when: Communication workflow logic changes
└─ Does NOT: Implement provider-specific logic
```

**Anti-pattern to Avoid:**
```
❌ BAD: God Class (violates SRP)

class CommunicationService {
  // Too many responsibilities!
  sendEmail() { /* SMTP logic */ }
  sendWhatsApp() { /* WhatsApp logic */ }
  encryptCredentials() { /* Encryption logic */ }
  fetchClinicConfig() { /* Database logic */ }
  cacheConfig() { /* Redis logic */ }
  trackMetrics() { /* Monitoring logic */ }
}
```

---

#### **2. Open/Closed Principle (OCP)**

**Open for extension, closed for modification:**

```typescript
// ✅ GOOD: New providers can be added WITHOUT modifying existing code

// Base interface (stable, not modified)
interface EmailProviderAdapter {
  send(options: EmailOptions): Promise<EmailResult>;
  verify(): Promise<boolean>;
  getHealthStatus(): ProviderHealthStatus;
}

// Existing adapters (never modified when adding new providers)
class SMTPEmailAdapter implements EmailProviderAdapter { }
class SESEmailAdapter implements EmailProviderAdapter { }
class SendGridAdapter implements EmailProviderAdapter { }

// NEW provider (extends system without modifying existing code)
class MailgunAdapter implements EmailProviderAdapter {
  // Implements interface, no changes to other adapters
}

// Factory pattern enables extension
class ProviderFactory {
  createEmailAdapter(config: ClinicEmailConfig): EmailProviderAdapter {
    switch (config.provider) {
      case 'smtp': return new SMTPEmailAdapter(config);
      case 'ses': return new SESEmailAdapter(config);
      case 'sendgrid': return new SendGridAdapter(config);
      case 'mailgun': return new MailgunAdapter(config); // ← NEW, no modification to existing
      default: throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }
}
```

**Key Benefits:**
- ✅ Add Mailgun without touching SMTP code
- ✅ Add Postmark without touching SendGrid code
- ✅ Each adapter is independently testable
- ✅ Existing adapters remain stable

---

#### **3. Liskov Substitution Principle (LSP)**

**Any provider adapter can replace another without breaking the system:**

```typescript
// ✅ GOOD: All adapters are substitutable

interface EmailProviderAdapter {
  send(options: EmailOptions): Promise<EmailResult>;
  verify(): Promise<boolean>;
  getHealthStatus(): ProviderHealthStatus;
}

// All implementations must follow the contract
class SMTPEmailAdapter implements EmailProviderAdapter {
  async send(options: EmailOptions): Promise<EmailResult> {
    // MUST return EmailResult format
    return { success: true, messageId: 'smtp-123' };
  }
}

class SESEmailAdapter implements EmailProviderAdapter {
  async send(options: EmailOptions): Promise<EmailResult> {
    // MUST return same EmailResult format
    return { success: true, messageId: 'ses-456' };
  }
}

// EmailService can use ANY adapter interchangeably
class EmailService {
  async sendEmail(adapter: EmailProviderAdapter, options: EmailOptions) {
    // Works with SMTP, SES, SendGrid, or ANY future adapter
    const result = await adapter.send(options);
    return result;
  }
}
```

**Contract Enforcement:**
- ✅ All adapters return `EmailResult` (not custom formats)
- ✅ All adapters throw consistent exceptions
- ✅ All adapters respect timeouts and retries
- ✅ Clinic can switch providers without code changes

---

#### **4. Interface Segregation Principle (ISP)**

**Clients should not depend on interfaces they don't use:**

```typescript
// ✅ GOOD: Segregated interfaces

// Email-specific capabilities
interface EmailProviderAdapter {
  send(options: EmailOptions): Promise<EmailResult>;
  verify(): Promise<boolean>;
  getHealthStatus(): ProviderHealthStatus;
}

// Template-specific capabilities (only for providers that support it)
interface TemplatedEmailProviderAdapter extends EmailProviderAdapter {
  sendTemplate(templateId: string, variables: object): Promise<EmailResult>;
}

// Tracking-specific capabilities (only for providers that support it)
interface TrackableEmailProviderAdapter extends EmailProviderAdapter {
  enableBounceTracking(): void;
  enableClickTracking(): void;
  enableOpenTracking(): void;
}

// SMTP only implements basic interface (no tracking/templates)
class SMTPEmailAdapter implements EmailProviderAdapter { }

// SendGrid implements all (templates + tracking)
class SendGridAdapter 
  implements EmailProviderAdapter, 
             TemplatedEmailProviderAdapter, 
             TrackableEmailProviderAdapter { }
```

**❌ BAD: Fat interface forces unnecessary implementations**
```typescript
// Forces all adapters to implement features they don't support
interface EmailProviderAdapter {
  send(): Promise<EmailResult>;
  sendTemplate(): Promise<EmailResult>;      // ← SMTP doesn't support
  enableBounceTracking(): void;              // ← SMTP doesn't support
  enableClickTracking(): void;               // ← SMTP doesn't support
  configureDomainKeys(): void;               // ← Not all providers support
}
```

---

#### **5. Dependency Inversion Principle (DIP)**

**Depend on abstractions, not concretions:**

```typescript
// ✅ GOOD: High-level modules depend on abstractions

// Abstraction (interface)
interface ICommunicationService {
  getEmailConfig(clinicId: string): Promise<ClinicEmailConfig>;
  getWhatsAppConfig(clinicId: string): Promise<ClinicWhatsAppConfig>;
}

// High-level module depends on abstraction
@Injectable()
class EmailService {
  constructor(
    // Depends on INTERFACE, not concrete class
    private readonly clinicCommService: ICommunicationService
  ) {}
}

// Low-level module implements abstraction
@Injectable()
class CommunicationService implements ICommunicationService {
  constructor(
    // Also depends on abstractions
    private readonly cacheService: ICacheService,
    private readonly databaseService: IDatabaseService,
    private readonly encryptionService: IEncryptionService
  ) {}
}

// Easy to mock for testing
class MockCommunicationService implements ICommunicationService {
  async getEmailConfig() { return mockConfig; }
  async getWhatsAppConfig() { return mockConfig; }
}
```

**❌ BAD: Tight coupling to concrete classes**
```typescript
class EmailService {
  constructor(
    private readonly clinicCommService: CommunicationService, // ← Concrete class
    private readonly redis: RedisClient,                            // ← Concrete class
    private readonly prisma: PrismaClient                          // ← Concrete class
  ) {}
}
// Hard to test, hard to swap implementations
```

---

### **🔁 DRY (Don't Repeat Yourself) Principles**

#### **1. Extract Common Provider Logic**

```typescript
// ✅ GOOD: Base adapter class for common logic

abstract class BaseEmailAdapter implements EmailProviderAdapter {
  // Common validation logic (DRY)
  protected validateEmailOptions(options: EmailOptions): void {
    if (!options.to) throw new Error('Recipient required');
    if (!options.subject) throw new Error('Subject required');
    if (!this.isValidEmail(options.to)) throw new Error('Invalid email');
  }

  // Common retry logic (DRY)
  protected async sendWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.delay(Math.pow(2, i) * 1000); // Exponential backoff
      }
    }
  }

  // Common health check logic (DRY)
  async getHealthStatus(): Promise<ProviderHealthStatus> {
    try {
      await this.verify();
      return { status: 'healthy', lastCheck: new Date() };
    } catch {
      return { status: 'down', lastCheck: new Date() };
    }
  }

  // Abstract methods for provider-specific logic
  abstract send(options: EmailOptions): Promise<EmailResult>;
  abstract verify(): Promise<boolean>;
}

// Concrete adapters inherit common logic
class SMTPEmailAdapter extends BaseEmailAdapter {
  async send(options: EmailOptions): Promise<EmailResult> {
    this.validateEmailOptions(options); // ← Reused from base
    return this.sendWithRetry(() => this.sendSMTP(options)); // ← Reused from base
  }
}

class SESEmailAdapter extends BaseEmailAdapter {
  async send(options: EmailOptions): Promise<EmailResult> {
    this.validateEmailOptions(options); // ← Reused from base
    return this.sendWithRetry(() => this.sendSES(options)); // ← Reused from base
  }
}
```

#### **2. Centralized Configuration Management**

```typescript
// ✅ GOOD: Single source of truth for configuration

// config/communication.config.ts
export const COMMUNICATION_CONFIG = {
  CACHE_TTL: 3600,
  CACHE_PREFIX: 'clinic:comm:',
  CONNECTION_POOL_SIZE: 5,
  MAX_RETRIES: 3,
  REQUEST_TIMEOUT: 30000,
  RATE_LIMIT_WINDOW: 60000,
} as const;

// Used consistently across all services
class CommunicationService {
  private readonly CACHE_TTL = COMMUNICATION_CONFIG.CACHE_TTL; // ← Single source
}

class SMTPEmailAdapter {
  private readonly MAX_RETRIES = COMMUNICATION_CONFIG.MAX_RETRIES; // ← Single source
}
```

#### **3. Reusable Error Handling**

```typescript
// ✅ GOOD: Centralized error handling utilities

// utils/communication-errors.ts
export class CommunicationError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly clinicId: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'CommunicationError';
  }
}

export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: { provider: string; clinicId: string; operation: string }
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Consistent error logging
    await loggingService.log(
      LogType.COMMUNICATION,
      LogLevel.ERROR,
      `${context.operation} failed for clinic ${context.clinicId}`,
      `${context.provider}Adapter`,
      { error: error instanceof Error ? error.message : 'Unknown error' }
    );
    throw new CommunicationError(
      `${context.operation} failed`,
      context.provider,
      context.clinicId,
      error as Error
    );
  }
}

// Used consistently across all adapters
class SMTPEmailAdapter {
  async send(options: EmailOptions): Promise<EmailResult> {
    return withErrorHandling(
      () => this.sendSMTP(options),
      { provider: 'smtp', clinicId: options.clinicId, operation: 'send' }
    );
  }
}
```

---

### **💋 KISS (Keep It Simple, Stupid) Principles**

#### **1. Simple, Predictable API**

```typescript
// ✅ GOOD: Simple, self-documenting interface

// User just needs clinicId and message details
await communicationService.send({
  clinicId: 'clinic-a-id',
  channels: ['email', 'whatsapp'],
  recipients: [{ email: 'patient@example.com', phone: '+123456789' }],
  title: 'Appointment Reminder',
  body: 'Your appointment is tomorrow at 10 AM'
});

// System handles complexity internally:
// - Fetches clinic config
// - Selects providers
// - Encrypts/decrypts credentials
// - Manages connection pools
// - Handles retries and fallbacks
// - Tracks metrics
```

**❌ BAD: Complex, leaky abstraction**
```typescript
// User needs to understand internal complexity
const config = await getClinicConfig(clinicId);
const decrypted = await decryptCredentials(config);
const adapter = createAdapter(decrypted);
const pool = getConnectionPool(clinicId);
const connection = await pool.acquire();
const result = await adapter.send(connection, message);
await pool.release(connection);
```

#### **2. Clear Separation of Concerns**

```
Simple Layer Boundaries:

Business Logic (AppointmentService)
        ↓
Communication Orchestrator (CommunicationService)
        ↓
Configuration Layer (CommunicationService)
        ↓
Provider Layer (Adapters)
        ↓
External Services (SMTP, SES, WhatsApp API)

Each layer has ONE job, simple interface
```

#### **3. Convention Over Configuration**

```typescript
// ✅ GOOD: Sensible defaults, minimal config

// Clinic only configures what's necessary
{
  "provider": "smtp",
  "smtp": {
    "host": "smtp.gmail.com",
    "user": "clinic@example.com",
    "password": "***"
  }
}

// System provides intelligent defaults:
// - port: 587 (standard TLS)
// - secure: false (TLS, not SSL)
// - maxConnections: 5 (reasonable default)
// - retryAttempts: 3 (standard retry logic)
// - timeout: 30s (reasonable timeout)
// - fallbackToGlobal: true (safe default)
```

---

### **🏢 Enterprise-Level Architecture (10M Users)**

#### **1. Scalability Patterns**

**Horizontal Scaling:**
```
Load Balancer
      ↓
┌──────────┬──────────┬──────────┐
│ App     │ App      │ App      │  ← Stateless instances
│ Node 1  │ Node 2   │ Node 3   │     (Scale to N)
└────┬─────┴────┬─────┴────┬─────┘
     │          │          │
     └──────────┴──────────┘
              ↓
     Shared Redis Cluster  ← Shared state (configs, sessions, rate limits)
              ↓
     PostgreSQL (Primary + Replicas)
```

**Performance Targets:**
- Support 200+ clinics simultaneously
- Handle 10M users across all clinics
- Process 1000 emails/sec, 500 WhatsApp/sec
- Config fetch latency: <100ms (P95)
- Message delivery latency: <500ms (P95)

---

#### **2. Resilience Patterns**

**Circuit Breaker:**
```typescript
// Prevents cascading failures

class ProviderCircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private readonly threshold = 5; // Open after 5 failures
  private readonly timeout = 60000; // Try again after 60s

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = 'HALF_OPEN'; // Try again
      } else {
        throw new Error('Circuit breaker OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.lastFailure = Date.now();
    }
  }
}
```

**Bulkhead Pattern:**
```typescript
// Isolate resources per clinic

class ConnectionPoolManager {
  private pools: Map<string, ConnectionPool> = new Map();
  
  getPool(clinicId: string, provider: string): ConnectionPool {
    const key = `${clinicId}:${provider}`;
    
    if (!this.pools.has(key)) {
      // Each clinic gets isolated pool (bulkhead)
      this.pools.set(key, new ConnectionPool({
        maxConnections: 5,      // Limit per clinic
        maxIdleTime: 300000,    // 5 minutes
        maxLifetime: 3600000    // 1 hour
      }));
    }
    
    return this.pools.get(key)!;
  }
}

// Benefit: One clinic's pool exhaustion doesn't affect others
```

**Retry with Exponential Backoff:**
```typescript
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
      await sleep(delay);
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

#### **3. Observability & Monitoring**

**Structured Logging:**
```typescript
// Always log with context

await loggingService.log(
  LogType.COMMUNICATION,
  LogLevel.INFO,
  'Email sent successfully',
  'SMTPEmailAdapter',
  {
    clinicId: 'clinic-a-id',
    provider: 'smtp',
    messageId: 'msg-123',
    recipient: 'patient@example.com', // Masked in production
    latency: 250,
    timestamp: new Date().toISOString()
  }
);
```

**Distributed Tracing:**
```typescript
// Track requests across services

async send(request: CommunicationRequest) {
  const traceId = generateTraceId();
  const span = tracer.startSpan('communication.send', { traceId });
  
  try {
    span.setTag('clinicId', request.metadata.clinicId);
    span.setTag('channels', request.channels.join(','));
    
    // Propagate trace context
    const result = await this.sendWithTrace(request, traceId);
    
    span.setTag('success', true);
    return result;
  } catch (error) {
    span.setTag('error', true);
    span.log({ event: 'error', message: error.message });
    throw error;
  } finally {
    span.finish();
  }
}
```

**Metrics Collection:**
```typescript
// Track key metrics

class MetricsService {
  recordEmailSent(clinicId: string, provider: string, latency: number) {
    this.histogram('communication.email.latency', latency, {
      clinicId, provider
    });
    this.counter('communication.email.sent', 1, {
      clinicId, provider
    });
  }

  recordEmailFailed(clinicId: string, provider: string, errorType: string) {
    this.counter('communication.email.failed', 1, {
      clinicId, provider, errorType
    });
  }
}
```

---

#### **4. Security Architecture**

**Defense in Depth:**
```
Layer 1: WAF (DDoS, SQL injection, XSS protection)
Layer 2: API Gateway (Rate limiting, authentication)
Layer 3: Application (RBAC, input validation)
Layer 4: Database (Row-level security, encryption at rest)
Layer 5: Network (VPC, security groups, private subnets)
```

**Credential Security:**
```
Storage: AES-256-GCM encrypted in database
Transit: TLS 1.3 for all API calls
Memory: Cleared after use, no logging
Rotation: Automated key rotation every 90 days
Access: RBAC-controlled, audit logged
```

**Rate Limiting (Sliding Window):**
```typescript
// Per-clinic, per-channel rate limits

class RateLimiter {
  async checkLimit(
    clinicId: string,
    channel: 'email' | 'whatsapp' | 'sms'
  ): Promise<boolean> {
    const key = `rate:${clinicId}:${channel}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    
    // Sliding window algorithm
    await redis.zremrangebyscore(key, 0, now - windowMs);
    const count = await redis.zcard(key);
    
    const limit = this.getLimitForChannel(channel);
    if (count >= limit) {
      return false; // Rate limit exceeded
    }
    
    await redis.zadd(key, now, `${now}-${randomUUID()}`);
    await redis.expire(key, 60);
    return true;
  }
}
```

---

### **✅ Architecture Validation Checklist**

#### **SOLID Compliance**
- [x] Each service has single responsibility
- [x] Provider adapters are extensible without modification
- [x] All adapters are substitutable
- [x] Interfaces are segregated (basic, template, tracking)
- [x] Dependencies on abstractions, not concretions

#### **DRY Compliance**
- [x] Common logic extracted to base classes
- [x] Configuration centralized
- [x] Error handling reused
- [x] No duplicate provider logic

#### **KISS Compliance**
- [x] Simple public APIs
- [x] Complexity hidden in layers
- [x] Sensible defaults
- [x] Clear separation of concerns

#### **Enterprise Readiness**
- [x] Horizontal scalability (stateless services)
- [x] Circuit breakers for resilience
- [x] Connection pooling per clinic
- [x] Distributed tracing
- [x] Comprehensive metrics
- [x] Defense-in-depth security
- [x] Rate limiting per clinic
- [x] Audit logging
- [x] Health checks
- [x] Graceful degradation

#### **10M User Scalability**
- [x] Supports 200+ clinics
- [x] Handles 1000 emails/sec
- [x] Handles 500 WhatsApp/sec
- [x] <100ms config fetch (P95)
- [x] <500ms message delivery (P95)
- [x] Redis caching (99% reduction in DB load)
- [x] Connection pooling (reuse, not recreate)
- [x] Bulkhead pattern (fault isolation)

---

## 🗄️ Database Schema Design

### **Approach 1: Extend `Clinic.settings` JSONB** (Recommended)

**Pros:**
- ✅ Single source of truth
- ✅ Flexible schema evolution
- ✅ Easier to query and update
- ✅ Built-in versioning capability

**Structure:**

```typescript
interface ClinicSettings {
  // ... existing settings (appointment, billing, security) ...
  
  // NEW: Communication Settings
  communicationSettings: {
    // Version for future schema migrations
    version: '1.0.0';
    
    // Email Configuration
    email: {
      // Primary provider
      provider: 'smtp' | 'ses' | 'sendgrid' | 'mailgun' | 'postmark' | 'disabled';
      
      // Provider-specific configurations (encrypted at rest)
      providers: {
        // SMTP (Gmail, Outlook, Custom SMTP servers)
        smtp?: {
          host: string;           // smtp.gmail.com, smtp.office365.com
          port: number;           // 587 (TLS), 465 (SSL), 25
          secure: boolean;        // true for SSL/TLS
          user: string;           // appointments@clinic.com
          password: string;       // [ENCRYPTED] SMTP password
          from: string;           // "Clinic Name <no-reply@clinic.com>"
          replyTo?: string;       // Optional reply-to address
          maxConnections?: number; // Connection pool size (default: 5)
        };
        
        // AWS SES
        ses?: {
          region: string;         // us-east-1, ap-south-1, etc.
          accessKeyId: string;    // [ENCRYPTED] AWS Access Key
          secretAccessKey: string;// [ENCRYPTED] AWS Secret Key
          fromEmail: string;      // verified@clinic.com (must be verified in SES)
          fromName: string;       // Clinic Name
          configurationSet?: string; // For tracking bounces/complaints
        };
        
        // SendGrid
        sendgrid?: {
          apiKey: string;         // [ENCRYPTED] SendGrid API Key
          fromEmail: string;      // verified@clinic.com
          fromName: string;       // Clinic Name
          templateId?: string;    // SendGrid template ID
        };
        
        // Mailgun
        mailgun?: {
          apiKey: string;         // [ENCRYPTED] Mailgun API Key
          domain: string;         // mg.clinic.com
          fromEmail: string;
          fromName: string;
          region?: 'us' | 'eu';   // Mailgun region
        };
        
        // Postmark
        postmark?: {
          serverToken: string;    // [ENCRYPTED] Postmark Server Token
          fromEmail: string;
          fromName: string;
          messageStream?: string; // 'outbound', 'broadcast', etc.
        };
        
        // Mailtrap (Dev/Staging only)
        mailtrap?: {
          apiToken: string;       // [ENCRYPTED] Mailtrap API Token
          inboxId: string;
        };
      };
      
      // Fallback strategy
      fallbackStrategy: {
        enabled: boolean;         // Enable fallback to global config
        fallbackProvider?: 'smtp' | 'ses' | 'sendgrid' | 'global';
        retryAttempts: number;    // Retry count before fallback (default: 2)
      };
      
      // Email-specific settings
      settings: {
        dailyLimit?: number;      // Max emails per day (quota management)
        hourlyLimit?: number;     // Max emails per hour
        enableBounceTracking: boolean;
        enableClickTracking: boolean;
        enableOpenTracking: boolean;
      };
    };
    
    // WhatsApp Configuration
    whatsapp: {
      enabled: boolean;
      provider: 'meta' | 'twilio' | 'messagebird' | 'vonage' | 'disabled';
      
      // Provider-specific configurations
      providers: {
        // Meta (Facebook) WhatsApp Business API (Official)
        meta?: {
          apiUrl: string;          // https://graph.facebook.com/v17.0 (or v18.0)
          apiKey: string;          // [ENCRYPTED] Access Token
          phoneNumberId: string;   // WhatsApp Phone Number ID
          businessAccountId: string; // WhatsApp Business Account ID
          
          // Clinic-specific template IDs (must be pre-approved by Meta)
          templates: {
            otp: string;                    // OTP verification template
            appointmentReminder: string;     // Appointment reminder
            appointmentConfirmation: string; // Booking confirmation
            appointmentCancellation: string; // Cancellation notice
            prescriptionReady: string;       // Prescription notification
            followUpReminder: string;        // Follow-up reminder
            billingStatement: string;        // Billing/payment
            customMessage?: string;          // Generic template
          };
          
          // Webhook for delivery status (optional)
          webhookUrl?: string;
          webhookSecret?: string;  // [ENCRYPTED]
        };
        
        // Twilio WhatsApp
        twilio?: {
          accountSid: string;      // [ENCRYPTED] Twilio Account SID
          authToken: string;       // [ENCRYPTED] Twilio Auth Token
          fromNumber: string;      // whatsapp:+1234567890
          messagingServiceSid?: string; // For load balancing
        };
        
        // MessageBird WhatsApp
        messagebird?: {
          apiKey: string;          // [ENCRYPTED] MessageBird API Key
          channelId: string;       // WhatsApp Channel ID
          fromNumber: string;      // +1234567890
        };
        
        // Vonage (Nexmo) WhatsApp
        vonage?: {
          apiKey: string;          // [ENCRYPTED] Vonage API Key
          apiSecret: string;       // [ENCRYPTED] Vonage API Secret
          fromNumber: string;      // 1234567890
        };
      };
      
      // Fallback strategy
      fallbackStrategy: {
        enabled: boolean;
        fallbackProvider?: 'meta' | 'twilio' | 'sms' | 'global';
        retryAttempts: number;    // Default: 2
      };
      
      // Rate limiting per clinic (respects Meta/provider limits)
      rateLimit: {
        enabled: boolean;
        maxPerMinute: number;     // e.g., 80 msgs/min (Meta limit: 80)
        maxPerHour: number;       // e.g., 1000 msgs/hour
        maxPerDay: number;        // e.g., 10000 msgs/day
        burstLimit: number;       // Max in 1 second (default: 10)
      };
      
      // WhatsApp-specific settings
      settings: {
        enableDeliveryReceipts: boolean;
        enableReadReceipts: boolean;
        defaultLanguage: string;  // 'en', 'hi', 'es', etc.
      };
    };
    
    // SMS Configuration
    sms: {
      enabled: boolean;
      provider: 'twilio' | 'aws-sns' | 'messagebird' | 'vonage' | 'disabled';
      
      // Provider-specific configurations
      providers: {
        // Twilio SMS
        twilio?: {
          accountSid: string;     // [ENCRYPTED] Twilio Account SID
          authToken: string;      // [ENCRYPTED] Twilio Auth Token
          fromNumber: string;     // +1234567890
          messagingServiceSid?: string;
        };
        
        // AWS SNS
        awsSns?: {
          region: string;         // us-east-1, ap-south-1, etc.
          accessKeyId: string;    // [ENCRYPTED] AWS Access Key
          secretAccessKey: string;// [ENCRYPTED] AWS Secret Key
          senderId?: string;      // Alpha-numeric sender ID (country-dependent)
        };
        
        // MessageBird SMS
        messagebird?: {
          apiKey: string;         // [ENCRYPTED] MessageBird API Key
          originator: string;     // Sender ID or phone number
        };
        
        // Vonage (Nexmo) SMS
        vonage?: {
          apiKey: string;         // [ENCRYPTED] Vonage API Key
          apiSecret: string;      // [ENCRYPTED] Vonage API Secret
          from: string;           // Sender ID or phone
        };
      };
      
      // Fallback strategy
      fallbackStrategy: {
        enabled: boolean;
        fallbackProvider?: 'twilio' | 'aws-sns' | 'global';
        retryAttempts: number;
      };
      
      // Rate limiting
      rateLimit: {
        enabled: boolean;
        maxPerMinute: number;
        maxPerHour: number;
        maxPerDay: number;
      };
    };
    
    // Notification preferences per clinic
    preferences: {
      defaultChannels: ('email' | 'whatsapp' | 'sms' | 'push')[];
      appointmentReminders: {
        enabled: boolean;
        channels: ('email' | 'whatsapp' | 'sms')[];
        timings: number[]; // Hours before: [24, 2]
      };
      criticalAlerts: {
        enabled: boolean;
        channels: ('email' | 'whatsapp' | 'sms' | 'push')[];
      };
    };
  };
}
```

### **Approach 2: Separate Table** (Alternative)

**Pros:**
- ✅ Better for very large configs
- ✅ Separate versioning per provider
- ✅ Can attach metadata (usage stats, health checks)

**Cons:**
- ❌ More complex queries
- ❌ Potential N+1 issues
- ❌ Harder to maintain consistency

**Schema Design:**

```sql
CREATE TABLE "clinic_communication_providers" (
  "id" TEXT PRIMARY KEY,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id"),
  "channel" TEXT NOT NULL,          -- 'email', 'whatsapp', 'sms'
  "provider" TEXT NOT NULL,         -- 'smtp', 'ses', 'sendgrid', 'meta', 'twilio'
  "config" JSONB NOT NULL,          -- [ENCRYPTED] Provider credentials
  "isActive" BOOLEAN DEFAULT true,
  "priority" INTEGER DEFAULT 1,     -- For fallback order (1 = primary, 2 = secondary)
  "usageStats" JSONB,               -- Track sent/failed messages
  "lastUsedAt" TIMESTAMP,
  "healthStatus" TEXT DEFAULT 'healthy', -- 'healthy', 'degraded', 'down'
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  
  UNIQUE("clinicId", "channel", "provider")
);

-- Indexes for performance
CREATE INDEX idx_clinic_comm_providers_clinic ON clinic_communication_providers("clinicId");
CREATE INDEX idx_clinic_comm_providers_active ON clinic_communication_providers("isActive");
CREATE INDEX idx_clinic_comm_providers_priority ON clinic_communication_providers("priority");
CREATE INDEX idx_clinic_comm_providers_health ON clinic_communication_providers("healthStatus");
```

**Recommendation**: Use **Approach 1 (JSONB in Clinic.settings)** for initial implementation, migrate to **Approach 2** if needed for scale.

---

## 🔐 Security Architecture

### **1. Credential Encryption Strategy**

**Encryption Requirements:**
- ✅ **At-Rest Encryption**: All credentials encrypted in database
- ✅ **In-Transit Encryption**: TLS/SSL for all API calls
- ✅ **Memory Protection**: Credentials cleared after use
- ✅ **Key Management**: Separate encryption keys per environment

**Encryption Approach Options:**

#### **Option A: Application-Level Encryption**
```
Pros:
• Full control over encryption logic
• Works with any database
• Can use AES-256-GCM for authenticated encryption

Cons:
• Encryption key must be in application memory
• Key rotation requires manual intervention

Algorithm: AES-256-GCM
Key Storage: Environment variable or KMS
Format: iv:authTag:encryptedData
```

#### **Option B: AWS KMS / Secrets Manager** (Production Recommended)
```
Pros:
• Centralized key management
• Automatic key rotation
• Audit logging built-in
• Regional isolation

Cons:
• Requires AWS infrastructure
• API call latency (mitigated by caching)
• Additional cost

Integration: Fetch secrets on app start, cache in memory
Refresh: Every 1 hour or on demand
```

#### **Option C: HashiCorp Vault**
```
Pros:
• Cloud-agnostic
• Dynamic secrets support
• Fine-grained access policies

Cons:
• Additional infrastructure to manage
• More complex setup

Use case: Multi-cloud deployments
```

**Recommendation**: Use **AWS KMS/Secrets Manager** for production, **Application-Level** for dev/staging.

---

### **2. Access Control Design**

**RBAC Permissions:**

```
clinic:communication:view           → View current config (masked credentials)
clinic:communication:manage         → Update provider settings
clinic:communication:test           → Test provider connectivity
clinic:communication:stats          → View usage statistics
clinic:communication:delete         → Remove provider config
```

**Role Assignments:**

| Role | Permissions |
|------|-------------|
| **SuperAdmin** | All permissions across all clinics |
| **ClinicAdmin** | All permissions for their clinic only |
| **ClinicManager** | view, stats |
| **Doctor** | None (communication is backend concern) |
| **Patient** | None |

**Validation Rules:**
- ✅ User must belong to the clinic they're modifying
- ✅ Credentials must be validated before saving
- ✅ Test endpoint must be used before production deployment
- ✅ All changes must be audit-logged
- ✅ Rollback capability for failed configurations

---

## 🏗️ Implementation Strategy (High-Level)

### **Phase 1: Foundation & Architecture**

**Services to Create:**

#### **1. CommunicationService** (Configuration Manager)

**Responsibilities:**
- Fetch clinic-specific provider configurations from database
- Decrypt credentials using encryption service
- Cache configurations in Redis (1-hour TTL)
- Provide fallback to global configuration
- Handle connection pool management
- Track provider health status

**Key Methods:**
```
getEmailConfig(clinicId): Promise<ClinicEmailConfig>
getWhatsAppConfig(clinicId): Promise<ClinicWhatsAppConfig>
getSMSConfig(clinicId): Promise<ClinicSMSConfig>
updateConfig(clinicId, channel, config): Promise<void>
testConfig(clinicId, channel): Promise<TestResult>
invalidateCache(clinicId): Promise<void>
```

---

#### **2. Provider Adapter Interface** (Strategy Pattern)

**Purpose**: Abstract provider-specific implementation details

**Interface Definition:**
```
interface EmailProviderAdapter {
  send(options: EmailOptions): Promise<EmailResult>;
  verify(): Promise<boolean>;  // Test connection
  getHealthStatus(): ProviderHealthStatus;
}

interface WhatsAppProviderAdapter {
  sendMessage(to: string, message: string): Promise<WhatsAppResult>;
  sendTemplate(to: string, templateId: string, params: object): Promise<WhatsAppResult>;
  verify(): Promise<boolean>;
  getHealthStatus(): ProviderHealthStatus;
}
```

**Adapters to Implement:**
- `SMTPEmailAdapter` (Gmail, Outlook, custom SMTP)
- `SESEmailAdapter` (AWS SES)
- `SendGridAdapter` (SendGrid)
- `MailgunAdapter` (Mailgun)
- `PostmarkAdapter` (Postmark)
- `MetaWhatsAppAdapter` (Meta Business API)
- `TwilioWhatsAppAdapter` (Twilio)
- `MessageBirdWhatsAppAdapter` (MessageBird)
- `VonageWhatsAppAdapter` (Vonage)

---

#### **3. Provider Factory** (Factory Pattern)

**Responsibilities:**
- Instantiate appropriate provider adapter based on config
- Manage adapter lifecycle
- Provide adapter instances to services

**Pseudo-logic:**
```
class ProviderFactory {
  createEmailAdapter(config: ClinicEmailConfig): EmailProviderAdapter {
    switch (config.provider) {
      case 'smtp': return new SMTPEmailAdapter(config.providers.smtp);
      case 'ses': return new SESEmailAdapter(config.providers.ses);
      case 'sendgrid': return new SendGridAdapter(config.providers.sendgrid);
      // ... more providers
    }
  }
  
  createWhatsAppAdapter(config: ClinicWhatsAppConfig): WhatsAppProviderAdapter {
    switch (config.provider) {
      case 'meta': return new MetaWhatsAppAdapter(config.providers.meta);
      case 'twilio': return new TwilioWhatsAppAdapter(config.providers.twilio);
      // ... more providers
    }
  }
}
```

---

### **Phase 2: Service Layer Updates**

#### **4. Update EmailService**

**Changes Required:**
- Accept optional `clinicId` parameter in all send methods
- Fetch clinic config via `CommunicationService`
- Use `ProviderFactory` to get appropriate adapter
- Implement connection pooling per clinic
- Handle fallback logic

**Connection Pooling Strategy:**
```
Map<clinicId, Map<provider, AdapterInstance>>

Example:
clinic-a → { smtp: SMTPAdapter, ses: SESAdapter }
clinic-b → { sendgrid: SendGridAdapter }
clinic-c → { smtp: SMTPAdapter }
```

---

#### **5. Update WhatsAppService**

**Changes Required:**
- Similar to EmailService changes
- Handle Meta API rate limits per clinic
- Support template messages with clinic-specific templates
- Implement fallback to SMS if WhatsApp fails

---

#### **6. Update CommunicationService**

**Changes Required:**
- Extract `clinicId` from request metadata
- Pass `clinicId` to all channel services
- Handle cross-channel fallback (WhatsApp → SMS → Email)
- Track per-clinic delivery statistics

---

### **Phase 3: Security & Credentials**

#### **7. Credential Encryption Service**

**Algorithm**: AES-256-GCM (or AWS KMS/Secrets Manager)

**Responsibilities:**
- Encrypt credentials before storing in database
- Decrypt credentials when fetching config
- Rotate encryption keys (admin function)
- Audit all encryption/decryption operations

---

#### **8. RBAC & Access Control**

**Permissions Matrix:**
```
SuperAdmin    → Manage all clinics
ClinicAdmin   → Manage own clinic only
ClinicManager → View own clinic config (masked)
Others        → No access
```

**Validation:**
- User must belong to clinic
- Test config before saving
- Audit log all changes
- Rollback capability

---

### **Phase 4: Admin Interface & APIs**

#### **9. REST API Endpoints**

```
GET    /api/v1/clinics/:clinicId/communication/email
PUT    /api/v1/clinics/:clinicId/communication/email
POST   /api/v1/clinics/:clinicId/communication/email/test
DELETE /api/v1/clinics/:clinicId/communication/email

GET    /api/v1/clinics/:clinicId/communication/whatsapp
PUT    /api/v1/clinics/:clinicId/communication/whatsapp
POST   /api/v1/clinics/:clinicId/communication/whatsapp/test
DELETE /api/v1/clinics/:clinicId/communication/whatsapp

GET    /api/v1/clinics/:clinicId/communication/stats
GET    /api/v1/clinics/:clinicId/communication/health
```

---

#### **10. Admin UI (Future)**

**Features:**
- Provider selection dropdown
- Credential input form (encrypted display)
- Test connection button
- Usage statistics dashboard
- Health status monitoring
- Rollback to previous config

---

### **Phase 5: Monitoring & Observability**

#### **11. Metrics to Track**

**Per-Clinic Metrics:**
- Emails sent/failed per provider
- WhatsApp messages sent/failed per provider
- SMS sent/failed per provider
- Average delivery time
- Bounce rate
- Provider health status

**Global Metrics:**
- Total messages across all clinics
- Provider-wise distribution
- Failure patterns
- Cost tracking (optional)

---

### **Phase 6: Testing & Rollout**

#### **12. Testing Strategy**

1. **Unit Tests**: Each adapter independently
2. **Integration Tests**: End-to-end flow with test credentials
3. **Load Tests**: Concurrent requests from multiple clinics
4. **Failover Tests**: Provider failures and fallback logic

#### **13. Rollout Plan**

1. Deploy with global fallback (no breaking changes)
2. Migrate pilot clinics (2-3 clinics)
3. Monitor for 1 week
4. Gradual rollout to 10%, 50%, 100% clinics
5. Deprecate global config (optional, keep as emergency fallback)

---

## 🧪 Configuration Examples

### **Example 1: Clinic Using Gmail SMTP**

```json
POST /api/v1/clinics/clinic-a-id/communication/email

{
  "provider": "smtp",
  "providers": {
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "user": "appointments@clinic-a.com",
      "password": "app-specific-password",
      "from": "Clinic A <appointments@clinic-a.com>",
      "maxConnections": 5
    }
  },
  "fallbackStrategy": {
    "enabled": true,
    "fallbackProvider": "global",
    "retryAttempts": 2
  },
  "settings": {
    "dailyLimit": 5000,
    "hourlyLimit": 500,
    "enableBounceTracking": true
  }
}
```

---

### **Example 2: Clinic Using AWS SES**

```json
POST /api/v1/clinics/clinic-b-id/communication/email

{
  "provider": "ses",
  "providers": {
    "ses": {
      "region": "us-east-1",
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "fromEmail": "notify@clinic-b.com",
      "fromName": "Clinic B Notifications",
      "configurationSet": "clinic-b-tracking"
    }
  },
  "fallbackStrategy": {
    "enabled": false
  },
  "settings": {
    "enableBounceTracking": true,
    "enableClickTracking": true,
    "enableOpenTracking": true
  }
}
```

---

### **Example 3: Clinic Using SendGrid**

```json
POST /api/v1/clinics/clinic-c-id/communication/email

{
  "provider": "sendgrid",
  "providers": {
    "sendgrid": {
      "apiKey": "SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "fromEmail": "hello@clinic-c.com",
      "fromName": "Clinic C",
      "templateId": "d-1234567890abcdef"
    }
  },
  "fallbackStrategy": {
    "enabled": true,
    "fallbackProvider": "smtp"
  }
}
```

---

### **Example 4: Meta WhatsApp Business API**

```json
POST /api/v1/clinics/clinic-a-id/communication/whatsapp

{
  "enabled": true,
  "provider": "meta",
  "providers": {
    "meta": {
      "apiUrl": "https://graph.facebook.com/v17.0",
      "apiKey": "EAAxxxxxxxxxxxxxxxxxxxxxxxx",
      "phoneNumberId": "123456789012345",
      "businessAccountId": "987654321098765",
      "templates": {
        "otp": "clinic_a_otp_verification",
        "appointmentReminder": "clinic_a_appointment_reminder_24h",
        "appointmentConfirmation": "clinic_a_booking_confirmation",
        "appointmentCancellation": "clinic_a_cancellation_notice",
        "prescriptionReady": "clinic_a_prescription_ready",
        "followUpReminder": "clinic_a_followup_reminder"
      },
      "webhookUrl": "https://api.clinic-a.com/webhooks/whatsapp",
      "webhookSecret": "webhook_secret_key"
    }
  },
  "fallbackStrategy": {
    "enabled": true,
    "fallbackProvider": "sms",
    "retryAttempts": 2
  },
  "rateLimit": {
    "enabled": true,
    "maxPerMinute": 80,
    "maxPerHour": 1000,
    "maxPerDay": 10000,
    "burstLimit": 10
  },
  "settings": {
    "enableDeliveryReceipts": true,
    "enableReadReceipts": true,
    "defaultLanguage": "en"
  }
}
```

---

### **Example 5: Twilio WhatsApp (Alternative)**

```json
POST /api/v1/clinics/clinic-d-id/communication/whatsapp

{
  "enabled": true,
  "provider": "twilio",
  "providers": {
    "twilio": {
      "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "authToken": "your_auth_token_here",
      "fromNumber": "whatsapp:+14155238886",
      "messagingServiceSid": "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  },
  "fallbackStrategy": {
    "enabled": true,
    "fallbackProvider": "global"
  },
  "rateLimit": {
    "enabled": true,
    "maxPerMinute": 60,
    "maxPerDay": 5000
  }
}
```

---

### **Example 6: Multi-Provider Email Setup (Primary + Fallback)**

**Scenario**: Clinic wants SendGrid as primary, Gmail SMTP as fallback

```json
POST /api/v1/clinics/clinic-e-id/communication/email

{
  "provider": "sendgrid",
  "providers": {
    "sendgrid": {
      "apiKey": "SG.xxxxxxxxxxxxxxxx",
      "fromEmail": "noreply@clinic-e.com",
      "fromName": "Clinic E"
    },
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "user": "backup@clinic-e.com",
      "password": "backup-password",
      "from": "Clinic E Backup <backup@clinic-e.com>"
    }
  },
  "fallbackStrategy": {
    "enabled": true,
    "fallbackProvider": "smtp",
    "retryAttempts": 3
  }
}
```

---

### **Example 7: Request Flow with clinicId**

**Appointment Confirmation Email:**

```json
POST /api/v1/communication/send

{
  "category": "APPOINTMENT",
  "recipients": [
    {
      "userId": "patient-123",
      "email": "patient@example.com",
      "phoneNumber": "+919876543210"
    }
  ],
  "channels": ["email", "whatsapp"],
  "title": "Appointment Confirmed",
  "body": "Your appointment at Clinic A is confirmed for Dec 5, 2025 at 10:00 AM.",
  "metadata": {
    "clinicId": "clinic-a-id",  // ← CRITICAL for multi-tenant routing
    "appointmentId": "appt-789",
    "patientId": "patient-123"
  }
}
```

**System Behavior:**
1. `CommunicationService` receives request with `clinicId: "clinic-a-id"`
2. `CommunicationService` fetches Clinic A's email config from cache/DB
3. Finds: Clinic A uses Gmail SMTP (`smtp.gmail.com`)
4. `EmailService` uses `SMTPEmailAdapter` with Clinic A's credentials
5. Email sent from `appointments@clinic-a.com`
6. Similarly for WhatsApp: Uses Clinic A's Meta API credentials
7. WhatsApp sent from Clinic A's phone number

---

### **Example 8: Global Fallback (Clinic has no config)**

```json
// Clinic Z has no communication config set

Request: clinicId = "clinic-z-id"

Behavior:
1. CommunicationService checks database
2. No config found for Clinic Z
3. Checks fallbackStrategy.enabled = true (default)
4. Falls back to global configuration:
   - Email: Global SMTP (noreply@healthcare.com)
   - WhatsApp: Global Meta API (global phone number)
5. Message sent successfully using global credentials
```

---

## 🔄 Migration & Rollout Strategy

### **Phase 1: Foundation (Weeks 1-2)**
- ✅ Update database schema (`Clinic.settings` JSONB)
- ✅ Create `CommunicationService`
- ✅ Implement credential encryption
- ✅ Add provider adapter interfaces
- ✅ Deploy with global fallback (no breaking changes)
- ✅ All existing clinics continue using global config

### **Phase 2: Provider Adapters (Weeks 3-4)**
- ✅ Implement SMTP adapter
- ✅ Implement AWS SES adapter
- ✅ Implement SendGrid adapter
- ✅ Implement Meta WhatsApp adapter
- ✅ Implement Twilio WhatsApp adapter
- ✅ Write integration tests for each adapter

### **Phase 3: Service Layer Updates (Week 5)**
- ✅ Update `EmailService` to support multi-tenant
- ✅ Update `WhatsAppService` to support multi-tenant
- ✅ Update `CommunicationService` to pass `clinicId`
- ✅ Implement connection pooling per clinic
- ✅ Add health checks for providers

### **Phase 4: API & Admin Interface (Week 6)**
- ✅ Create REST API endpoints
- ✅ Add RBAC guards
- ✅ Implement test/validation endpoints
- ✅ Create admin UI for config management
- ✅ Add audit logging

### **Phase 5: Pilot Testing (Weeks 7-8)**
- ✅ Select 2-3 pilot clinics
- ✅ Migrate pilot clinics to their own configs
- ✅ Monitor for 2 weeks
- ✅ Gather feedback
- ✅ Fix any issues

### **Phase 6: Gradual Rollout (Weeks 9-12)**
- ✅ Week 9: Rollout to 10% of clinics
- ✅ Week 10: Rollout to 50% of clinics
- ✅ Week 11: Rollout to 90% of clinics
- ✅ Week 12: Rollout to 100% of clinics
- ✅ Monitor metrics continuously

### **Phase 7: Optimization (Ongoing)**
- ✅ Deprecate global config (optional, keep as emergency backup)
- ✅ Add more provider adapters based on demand
- ✅ Optimize connection pooling
- ✅ Implement advanced features (load balancing, auto-failover)

---

## 📊 Performance & Scalability

### **1. Connection Pooling Strategy**

**SMTP Connection Pooling:**
```
Map<clinicId, SMTPTransporter>

Pool Configuration:
- Max connections per clinic: 5
- Max messages per connection: 100
- Idle timeout: 5 minutes
- Connection reuse: Yes

Benefits:
- Reduces connection overhead
- Faster email delivery
- Lower resource usage
```

**SES/SendGrid Client Pooling:**
```
Map<clinicId, ProviderClient>

Pool Configuration:
- One client instance per clinic
- HTTP connection keep-alive
- Request timeout: 30 seconds

Benefits:
- Reuse HTTP connections
- Better throughput
- Lower latency
```

---

### **2. Configuration Caching**

**Redis Caching Strategy:**
```
Cache Key: clinic:comm:email:{clinicId}
Cache Key: clinic:comm:whatsapp:{clinicId}
Cache Key: clinic:comm:sms:{clinicId}

TTL: 1 hour (3600 seconds)
Invalidation: On config update

Estimated Reduction:
- Database queries: 99% reduction
- Config fetch latency: <5ms (vs 50-100ms DB query)
```

**Cache Hit Rate Target**: >95%

---

### **3. Rate Limiting**

**Per-Clinic Rate Limits:**
```
Email:
- SMTP: Dependent on provider limits
- SES: AWS account limits (per region)
- SendGrid: API plan limits

WhatsApp:
- Meta API: 80 messages/second, 1000/minute
- Twilio: 60 messages/second
- Per-clinic tracking prevents one clinic exhausting quota

SMS:
- Provider-dependent
- Tracked per clinic for fair usage
```

**Implementation**: Use Redis-based rate limiter (sliding window algorithm)

---

### **4. Scalability Targets**

**Current System:**
- 200 clinics
- 1M+ users across all clinics
- ~10K appointments/day

**Target Performance:**
- Email: 1000 emails/second across all clinics
- WhatsApp: 500 messages/second across all clinics
- Latency: <100ms for config fetch (cached)
- Latency: <500ms for message delivery (queued)

**Horizontal Scaling:**
- Stateless services (can scale to N instances)
- Shared Redis cache (cluster mode for >1TB data)
- Connection pools per app instance
- Load balancer distributes requests

---

## 🔍 Monitoring & Observability

### **1. Metrics to Track**

**Per-Clinic Metrics:**
```
communication.email.sent{clinicId, provider}
communication.email.failed{clinicId, provider, errorType}
communication.email.latency{clinicId, provider} (histogram)
communication.email.bounce_rate{clinicId}

communication.whatsapp.sent{clinicId, provider}
communication.whatsapp.failed{clinicId, provider, errorType}
communication.whatsapp.delivered{clinicId}
communication.whatsapp.read{clinicId}

communication.sms.sent{clinicId, provider}
communication.sms.failed{clinicId, provider, errorType}

communication.config.fetch_latency{clinicId, channel} (histogram)
communication.config.cache_hit{clinicId, channel}
communication.config.cache_miss{clinicId, channel}

communication.pool.active_connections{clinicId, provider}
communication.pool.idle_connections{clinicId, provider}
```

**Global Metrics:**
```
communication.total_sent{channel}
communication.total_failed{channel}
communication.active_clinics
communication.providers_in_use{provider}
```

---

### **2. Health Checks**

**Provider Health Status:**
```
Status: 'healthy' | 'degraded' | 'down'

Checks:
- Connection test every 5 minutes
- Success rate threshold: >95% = healthy, 80-95% = degraded, <80% = down
- Auto-fallback if provider is 'down' for >10 minutes
```

**Health Check Endpoints:**
```
GET /health/communication
GET /health/communication/clinics/:clinicId
GET /health/communication/providers/:provider
```

---

### **3. Alerts & Notifications**

**Critical Alerts** (Immediate notification):
- Provider completely down for any clinic
- Credential expiration within 7 days
- Rate limit exceeded (clinic unable to send)
- Bounce rate >10% for any clinic
- Connection pool exhausted

**Warning Alerts** (Slack/email):
- Provider degraded (success rate 80-95%)
- Rate limit at 80% capacity
- Cache hit rate <90%
- Config fetch latency >200ms (P95)
- Unusual spike in failures

**Info Alerts** (Dashboard only):
- New clinic configuration added
- Provider switched (primary → fallback)
- Configuration updated

---

### **4. Dashboards**

**Clinic Admin Dashboard:**
- Real-time delivery stats (last 24h, 7d, 30d)
- Success/failure rates per channel
- Cost breakdown (if applicable)
- Provider health status
- Recent messages log

**SuperAdmin Dashboard:**
- Global communication stats
- Per-clinic comparison
- Provider performance comparison
- System health overview
- Cost tracking across all clinics

**SRE Dashboard:**
- System performance metrics
- Error rate trends
- Latency percentiles (P50, P95, P99)
- Cache performance
- Connection pool utilization
- Alert history

---

## 🛡️ Security Checklist

- [x] All credentials encrypted at rest (AES-256-GCM)
- [x] Credentials never logged or exposed in errors
- [x] Access control via RBAC (SuperAdmin, ClinicAdmin only)
- [x] Audit logging for all config changes
- [x] Secure key management (environment variable)
- [x] Connection pooling with max connection limits
- [x] Rate limiting per clinic
- [x] Input validation on all config endpoints

---

## 📚 API Documentation

### **Endpoints**

```typescript
// Get current email config
GET /api/v1/clinics/:clinicId/communication/email
Authorization: Bearer <token>
Permissions: clinic:communication:view

// Update email config
PUT /api/v1/clinics/:clinicId/communication/email
Authorization: Bearer <token>
Permissions: clinic:communication:manage
Body: ClinicEmailConfigDto

// Test email config
POST /api/v1/clinics/:clinicId/communication/email/test
Authorization: Bearer <token>
Permissions: clinic:communication:manage
Body: { testEmail: string }

// Get current WhatsApp config
GET /api/v1/clinics/:clinicId/communication/whatsapp

// Update WhatsApp config
PUT /api/v1/clinics/:clinicId/communication/whatsapp

// Test WhatsApp config
POST /api/v1/clinics/:clinicId/communication/whatsapp/test
Body: { testPhone: string }

// Get communication statistics
GET /api/v1/clinics/:clinicId/communication/stats
Returns: {
  email: { sent: number, failed: number, lastSent: Date },
  whatsapp: { sent: number, failed: number, lastSent: Date }
}
```

---

## ✅ Benefits of This Approach

1. **🏥 True Multi-Tenancy**: Each clinic can use their own email/WhatsApp
2. **🎨 Better Branding**: Emails from clinic's own domain
3. **🔐 Security**: Credentials encrypted and isolated per clinic
4. **📈 Scalability**: Connection pooling + caching for 200+ clinics
5. **🛡️ Fault Isolation**: One clinic's config issues don't affect others
6. **⚡ Performance**: Redis caching + connection reuse
7. **🔄 Gradual Migration**: Fallback to global config during transition
8. **📊 Per-Clinic Monitoring**: Track usage and failures per clinic

---

## 🎯 Decision Matrix: When to Use Which Provider?

### **Email Provider Selection Guide**

| Provider | Best For | Pros | Cons | Cost |
|----------|----------|------|------|------|
| **SMTP (Gmail/Outlook)** | Small clinics, <500 emails/day | Free tier, easy setup | Limited features, lower reliability | Free - $10/month |
| **AWS SES** | High volume, technical clinics | Scalable, cheap, reliable | Requires AWS account, more complex | $0.10/1000 emails |
| **SendGrid** | Medium clinics, <10K/day | Easy API, good deliverability | More expensive | $15-$100/month |
| **Mailgun** | Developer-friendly clinics | Great API, flexible | Mid-tier pricing | $35-$80/month |
| **Postmark** | Transactional focus | Best deliverability, fast | Expensive for bulk | $15-$100/month |

### **WhatsApp Provider Selection Guide**

| Provider | Best For | Pros | Cons | Cost |
|----------|----------|------|------|------|
| **Meta Business API** | Official, enterprise clinics | Native features, official | Complex setup, requires approval | Pay-per-message (~$0.005-0.04) |
| **Twilio** | Quick setup, small clinics | Easy integration, reliable | Higher cost, fewer features | Pay-per-message (~$0.005-0.07) |
| **MessageBird** | Multi-channel clinics | SMS + WhatsApp bundled | Limited in some regions | Pay-per-message |
| **Vonage** | Global clinics | Good global coverage | API complexity | Pay-per-message |

---

## ✅ Benefits Summary

### **For Clinics:**
- 🎨 **Better Branding**: Emails from their own domain (appointments@clinic-a.com)
- 📞 **Own WhatsApp Number**: Patients recognize clinic's number
- 🔒 **Data Isolation**: Credentials not shared with other clinics
- 📊 **Usage Tracking**: See their own communication stats
- 🛡️ **Provider Choice**: Choose provider that fits their needs/budget
- 💰 **Cost Control**: Pay only for what they use

### **For Platform:**
- 🏗️ **True Multi-Tenancy**: Full isolation per clinic
- 📈 **Scalability**: Support 200+ clinics with different providers
- 🔌 **Flexibility**: Easy to add new providers (plugin architecture)
- 🛡️ **Fault Isolation**: One clinic's issue doesn't affect others
- 💼 **Enterprise-Ready**: Meets healthcare compliance requirements
- 🔧 **Maintainability**: Clean architecture, easy to extend

### **For Patients:**
- ✅ **Trust**: Recognize clinic's official email/WhatsApp
- 📧 **Consistency**: All messages from same clinic identity
- 🎯 **Relevance**: Clinic-specific branding and messaging
- 🔐 **Security**: Know they're communicating with right clinic

---

## 🚀 Implementation Checklist

### **Architecture & Design** (This Document)
- [x] High-level architecture diagram
- [x] Database schema design
- [x] Provider adapter strategy
- [x] Security architecture
- [x] Configuration examples
- [x] Performance considerations
- [x] Monitoring strategy
- [x] Migration plan

### **Development Tasks** (To Be Implemented)
- [ ] Extend `ClinicSettings` type definition
- [ ] Create `CredentialEncryptionService`
- [ ] Create `CommunicationService`
- [ ] Implement provider adapter interfaces
- [ ] Create SMTP email adapter
- [ ] Create AWS SES adapter
- [ ] Create SendGrid adapter
- [ ] Create Meta WhatsApp adapter
- [ ] Create Twilio WhatsApp adapter
- [ ] Update `EmailService` for multi-tenant
- [ ] Update `WhatsAppService` for multi-tenant
- [ ] Update `CommunicationService` to pass clinicId
- [ ] Implement connection pooling
- [ ] Create REST API endpoints
- [ ] Add RBAC guards
- [ ] Create admin UI components
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Setup monitoring dashboards
- [ ] Create migration scripts
- [ ] Write deployment docs

### **Testing & Rollout**
- [ ] Test with pilot clinics (2-3)
- [ ] Load testing (concurrent clinic requests)
- [ ] Failover testing
- [ ] Security audit
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor for 2 weeks post-rollout
- [ ] Gather feedback and iterate

---

## 📚 Related Documentation

- **Current Communication System**: `src/libs/communication/README.md`
- **Clinic Management**: `src/services/clinic/README.md`
- **RBAC & Security**: `.ai-rules/security.md`
- **Multi-Tenant Architecture**: `.ai-rules/architecture.md`
- **Database Guidelines**: `.ai-rules/database.md`

---

## 📞 Review & Approval

**This document requires review from:**
- [ ] **Tech Lead**: Architecture approval
- [ ] **Security Team**: Credential encryption strategy
- [ ] **DevOps Team**: Infrastructure requirements
- [ ] **Product Team**: Feature requirements
- [ ] **Compliance Team**: HIPAA/healthcare regulations

**Estimated Timeline:** 12 weeks (3 months) for full implementation and rollout

**Priority:** High (Critical for true multi-tenant healthcare platform)

---

## 📝 Document Version

- **Version**: 1.0.0
- **Last Updated**: December 3, 2025
- **Status**: Design/Architecture (No Implementation)
- **Next Review**: After stakeholder approval

