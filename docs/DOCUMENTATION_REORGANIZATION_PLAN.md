# Documentation Reorganization Plan
**Healthcare Backend - Documentation Consolidation & Restructuring**

**Date:** December 15, 2025
**Status:** Action Plan
**Goal:** Service-oriented documentation with zero duplication

---

## 🎯 Infrastructure Documentation Strategy

**Dual Documentation Approach:**

1. **Consolidated Documentation** (`src/INFRASTRUCTURE_DOCUMENTATION.md`)
   - ✅ **Already exists** - Comprehensive overview of all infrastructure services
   - **Purpose:** Architecture, design decisions, cross-service patterns, system-wide considerations
   - **Audience:** Architects, system designers, new team members understanding overall infrastructure

2. **Individual Service READMEs** (`src/libs/infrastructure/{service}/README.md`)
   - ❌ **Missing** - Need to create 8 individual READMEs
   - **Purpose:** Service-specific usage, quick start, API reference, examples, troubleshooting
   - **Audience:** Developers using the service, implementers, troubleshooters

**Relationship:**
- Individual READMEs link to consolidated doc for architecture context
- Consolidated doc links to individual READMEs for detailed usage
- Both complement each other - no duplication, clear separation of concerns

**Infrastructure Services Requiring Individual READMEs:**
1. Database Service (`database/README.md`)
2. Cache Service (`cache/README.md`)
3. Logging Service (`logging/README.md`)
4. Events Service (`events/README.md`)
5. Queue Service (`queue/README.md`)
6. Framework Service (`framework/README.md`)
7. Search Service (`search/README.md`)
8. Storage Service (`storage/README.md`)

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Proposed Structure](#proposed-structure)
3. [Action Plan](#action-plan)
4. [File Operations](#file-operations)
5. [Service README Templates](#service-readme-templates)
6. [Validation Checklist](#validation-checklist)

---

## Current State Analysis

### Documentation Statistics

| Category | Count | Status |
|----------|-------|--------|
| **Total Markdown Files** | 54 | Mixed quality |
| **Root READMEs** | 3 | ✅ Good |
| **docs/ Files** | 48 | ⚠️ Has duplicates |
| **Service READMEs** | 0/9 | ❌ Missing |
| **Infrastructure READMEs** | 1 consolidated, 0 individual | ⚠️ Needs individual READMEs |
| **Duplicate Files** | ~15 | ❌ Needs cleanup |

### Problems Identified

1. **No Service-Level Documentation**
   - 9 services (`auth`, `users`, `appointments`, `billing`, `ehr`, `video`, `notification`, `clinic`, `health`) have NO README files
   - Developers must search through `docs/` to understand services

2. **Documentation Duplication** (15 files)
   - Appointments: 3 files covering same topic
   - Multi-tenant Communication: 3 files
   - Developer Guide: 2 files with overlap
   - Integration Verification: 3 versions
   - Event Documentation: 2 similar files
   - Quick Start guides: Duplicate content

3. **Infrastructure Documentation**
   - ✅ Already consolidated into `src/INFRASTRUCTURE_DOCUMENTATION.md` (comprehensive overview)
   - ❌ **Missing individual READMEs** for each infrastructure service (8 services)
   - **Need BOTH:**
     - **Consolidated**: `src/INFRASTRUCTURE_DOCUMENTATION.md` - Complete infrastructure overview, cross-service patterns, architecture decisions
     - **Individual**: `src/libs/infrastructure/{service}/README.md` - Service-specific usage, API reference, examples, troubleshooting
   - **Relationship**: Individual READMEs link to consolidated doc for architecture context; consolidated doc links to individual READMEs for detailed usage

4. **Poor Discoverability**
   - No service-level entry point
   - Must navigate to `docs/` for everything
   - Difficult to understand a service in isolation

---

## Proposed Structure

### Service-Oriented Documentation Hierarchy

```
HealthCareBackend/
│
├── README.md (Main project overview)
├── CLAUDE.md (AI development guidelines)
├── QUICK_START_LOCAL.md (Local setup)
│
├── src/
│   ├── INFRASTRUCTURE_DOCUMENTATION.md (All infrastructure modules)
│   │
│   ├── services/
│   │   ├── appointments/
│   │   │   └── README.md ⭐ NEW - Appointment service guide
│   │   ├── auth/
│   │   │   └── README.md ⭐ NEW - Authentication service guide
│   │   ├── billing/
│   │   │   └── README.md ⭐ NEW - Billing service guide
│   │   ├── clinic/
│   │   │   └── README.md ⭐ NEW - Clinic management guide
│   │   ├── ehr/
│   │   │   └── README.md ⭐ NEW - EHR service guide
│   │   ├── health/
│   │   │   └── README.md ⭐ NEW - Health monitoring guide
│   │   ├── notification/
│   │   │   └── README.md ⭐ NEW - Notification service guide
│   │   ├── users/
│   │   │   └── README.md ⭐ NEW - User management guide
│   │   └── video/
│   │       └── README.md ⭐ NEW - Video consultation guide
│   │
│   ├── libs/
│   │   ├── communication/
│   │   │   └── README.md ⭐ NEW - Multi-channel communication
│   │   ├── payment/
│   │   │   └── README.md ⭐ NEW - Payment integration
│   │   ├── security/
│   │   │   └── README.md ⭐ NEW - Security utilities
│   │   ├── core/
│   │   │   └── README.md ⭐ NEW - Core utilities
│   │   └── infrastructure/
│   │       ├── database/
│   │       │   └── README.md ⭐ NEW - Database service guide
│   │       ├── cache/
│   │       │   └── README.md ⭐ NEW - Cache service guide
│   │       ├── logging/
│   │       │   └── README.md ⭐ NEW - Logging service guide
│   │       ├── events/
│   │       │   └── README.md ⭐ NEW - Event service guide
│   │       ├── queue/
│   │       │   └── README.md ⭐ NEW - Queue service guide
│   │       ├── framework/
│   │       │   └── README.md ⭐ NEW - Framework adapter guide
│   │       ├── search/
│   │       │   └── README.md ⭐ NEW - Search service guide
│   │       └── storage/
│   │           └── README.md ⭐ NEW - Storage service guide
│   │
│   └── config/
│       └── README.md ⭐ NEW - Configuration guide
│
└── docs/
    ├── README.md (Documentation hub)
    │
    ├── API_INTEGRATION_ANALYSIS.md ✅ KEEP
    ├── API_DOCUMENTATION.md ✅ KEEP
    ├── DEVELOPER_GUIDE.md ✅ KEEP (merge DEVELOPER_DOCUMENTATION.md into this)
    ├── CENTRAL_CONFIG_GUIDE.md ✅ KEEP
    ├── ENVIRONMENT_VARIABLES.md ✅ KEEP
    ├── CUSTOM_DOMAIN_SETUP.md ✅ KEEP
    ├── INFRASTRUCTURE_RECOMMENDATION.md ✅ KEEP
    ├── AI_INTEGRATION_EXAMPLES.md ✅ KEEP
    ├── UI_UX_CUSTOMIZATION_GUIDE.md ✅ KEEP
    ├── VIDEO_SERVICE.md ✅ KEEP
    ├── OPENVIDU_PRO_SETUP.md ✅ KEEP
    ├── OPENVIDU_CUSTOM_DOMAIN_DEPLOYMENT.md ✅ KEEP
    ├── FINAL_INTEGRATION_VERIFICATION.md ✅ KEEP
    │
    ├── api/
    │   └── README.md ✅ KEEP
    │
    ├── architecture/
    │   ├── SYSTEM_ARCHITECTURE.md ✅ KEEP
    │   ├── COMPLETE_SYSTEM_SUMMARY.md ✅ KEEP
    │   ├── EVENT_INTEGRATION.md ⭐ NEW (consolidate 2 event docs)
    │   ├── 10M_USER_SCALE_OPTIMIZATIONS.md ✅ KEEP
    │   ├── GRAPHQL_MIGRATION_FEASIBILITY.md ✅ KEEP
    │   └── PUSH_NOTIFICATION_RECOMMENDATIONS.md ✅ KEEP
    │
    ├── features/
    │   ├── APPOINTMENTS_COMPLETE.md ✅ KEEP
    │   ├── AYURVEDIC_ENHANCEMENTS.md ✅ KEEP
    │   ├── EVENT_DOCUMENTATION.md ✅ KEEP
    │   ├── IMPLEMENTATION_STATUS.md ✅ KEEP
    │   ├── INVOICE_PDF_WHATSAPP_FEATURE.md ✅ KEEP
    │   ├── LMS_INTEGRATION_STRATEGY.md ✅ KEEP
    │   ├── MULTI_TENANT_COMMUNICATION.md ⭐ NEW (consolidate 3 files)
    │   ├── NOTIFICATION_SYSTEM_IMPLEMENTATION.md ✅ KEEP
    │   ├── PAYMENT_BILLING_COMPLETE.md ✅ KEEP
    │   ├── QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md ✅ KEEP
    │   ├── RBAC_COMPLETE_IMPLEMENTATION.md ✅ KEEP
    │   └── SUBSCRIPTION_APPOINTMENTS.md ✅ KEEP
    │
    └── guides/
        ├── AI_IMPLEMENTATION_PROMPT.md ✅ KEEP
        ├── NOTIFICATION_IMPLEMENTATION_GUIDE.md ✅ KEEP
        ├── NOTIFICATION_STRATEGY.md ✅ KEEP
        ├── AWS_SES_INTEGRATION_GUIDE.md ✅ KEEP (merge AWS_QUICK_START)
        ├── AWS_SNS_INTEGRATION_GUIDE.md ✅ KEEP
        ├── FCM_INTEGRATION_GUIDE.md ✅ KEEP (merge FCM_QUICK_START)
        └── STORAGE_CONFIGURATION.md ✅ KEEP
```

---

## Action Plan

### Phase 1: Delete Duplicate Files (6 files)

**Files to Delete:**

1. ❌ `docs/features/APPOINTMENTS_README.md`
   - **Reason:** Just points to APPOINTMENTS_COMPLETE.md
   - **Action:** Delete, keep APPOINTMENTS_COMPLETE.md

2. ❌ `docs/INTEGRATION_VERIFICATION.md`
   - **Reason:** Superseded by FINAL_INTEGRATION_VERIFICATION.md
   - **Action:** Delete

3. ❌ `docs/architecture/INTEGRATION_VERIFICATION.md`
   - **Reason:** Duplicate of docs/INTEGRATION_VERIFICATION.md
   - **Action:** Delete

4. ❌ `docs/features/DEVELOPER_DOCUMENTATION.md`
   - **Reason:** Overlaps with docs/DEVELOPER_GUIDE.md
   - **Action:** Merge RBAC content into DEVELOPER_GUIDE.md, then delete

5. ❌ `docs/guides/AWS_QUICK_START.md`
   - **Reason:** Content should be in AWS integration guides
   - **Action:** Merge into AWS_SES_INTEGRATION_GUIDE.md as "Quick Start" section, delete

6. ❌ `docs/guides/FCM_QUICK_START.md`
   - **Reason:** Content should be in FCM_INTEGRATION_GUIDE.md
   - **Action:** Merge into FCM_INTEGRATION_GUIDE.md as "Quick Start" section, delete

---

### Phase 2: Consolidate Related Files (8 → 3 files)

#### A. Multi-Tenant Communication (3 → 1)

**Create:** `docs/features/MULTI_TENANT_COMMUNICATION.md`

**Consolidate these 3 files:**
1. `docs/features/MULTI_TENANT_COMMUNICATION_SOLUTION.md` (2816 lines)
2. `docs/features/MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_COMPLETE.md` (297 lines)
3. `docs/features/MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_STATUS.md` (397 lines)

**Structure:**
```markdown
# Multi-Tenant Communication System

## Table of Contents
1. Solution Architecture (from SOLUTION.md)
2. Implementation Guide (from IMPLEMENTATION_COMPLETE.md)
3. Status & Verification (from IMPLEMENTATION_STATUS.md)
4. Usage Examples
5. Testing Guide

## Solution Architecture
[Content from MULTI_TENANT_COMMUNICATION_SOLUTION.md]

## Implementation Guide
[Content from MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_COMPLETE.md]

## Status & Verification
[Content from MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_STATUS.md]
```

**Delete after consolidation:**
- MULTI_TENANT_COMMUNICATION_SOLUTION.md
- MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_COMPLETE.md
- MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_STATUS.md

---

#### B. Event Integration (2 → 1)

**Create:** `docs/architecture/EVENT_INTEGRATION.md`

**Consolidate these 2 files:**
1. `docs/architecture/EVENT_COMMUNICATION_INTEGRATION.md` (325 lines)
2. `docs/architecture/EVENT_DRIVEN_INTEGRATION.md` (321 lines)

**Structure:**
```markdown
# Event-Driven Integration Architecture

## Table of Contents
1. Event System Overview
2. Communication Integration
3. Event Patterns
4. Implementation Guide
5. Best Practices

## Event System Overview
[Consolidate both files - remove duplication]

## Communication Integration
[From EVENT_COMMUNICATION_INTEGRATION.md]

## Event Patterns
[From EVENT_DRIVEN_INTEGRATION.md]
```

**Delete after consolidation:**
- EVENT_COMMUNICATION_INTEGRATION.md
- EVENT_DRIVEN_INTEGRATION.md

---

#### C. Developer Guide Enhancement (2 → 1)

**Update:** `docs/DEVELOPER_GUIDE.md`

**Merge content from:**
- `docs/features/DEVELOPER_DOCUMENTATION.md` (RBAC patterns)

**New Section to Add:**
```markdown
## RBAC Patterns & Best Practices

[Content from docs/features/DEVELOPER_DOCUMENTATION.md - RBAC section]
```

**Delete after merge:**
- docs/features/DEVELOPER_DOCUMENTATION.md

---

### Phase 3: Create Service READMEs (22 new files)

Create lightweight, practical READMEs for each service/module with consistent structure.

**Infrastructure Services Strategy:**
- **Individual READMEs** (`src/libs/infrastructure/{service}/README.md`) - Service-specific usage, quick start, examples
- **Consolidated Doc** (`src/INFRASTRUCTURE_DOCUMENTATION.md`) - Architecture overview, cross-service patterns, design decisions
- **Relationship:** Individual READMEs link to consolidated doc for architecture; consolidated doc links to individual READMEs for usage

#### Service README Template

```markdown
# [Service Name] Service

**Purpose:** [One-line description]
**Location:** `src/services/[service-name]`
**Status:** Production-ready

---

## Quick Start

### Installation
```bash
# No separate installation - part of main project
pnpm install
```

### Basic Usage
```typescript
import { [ServiceName]Service } from '@services/[service-name]';

@Injectable()
export class MyService {
  constructor(private readonly [service]: [ServiceName]Service) {}

  async example() {
    // Usage example
  }
}
```

---

## Key Features

- ✅ Feature 1
- ✅ Feature 2
- ✅ Feature 3

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/path` | GET | ROLE | Description |

[Link to full API documentation](../../docs/api/README.md)

---

## Architecture

```
[ServiceName]Module
├── controllers/
│   └── [service].controller.ts
├── services/
│   └── [service].service.ts
├── dtos/
│   ├── create-[entity].dto.ts
│   └── update-[entity].dto.ts
└── [additional folders]
```

---

## Configuration

### Environment Variables

```env
# [Service Name] Configuration
SERVICE_VAR=value
```

[Full environment variables guide](../../docs/ENVIRONMENT_VARIABLES.md)

---

## Usage Examples

### Example 1: [Common Use Case]
```typescript
// Code example
```

### Example 2: [Another Common Use Case]
```typescript
// Code example
```

---

## Testing

```bash
# Run service tests
pnpm test [service-name]
```

---

## Dependencies

### Required Services
- DatabaseService
- LoggingService
- EventService
- CacheService

### Optional Services
- [List optional dependencies]

---

## Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `[entity].created` | { entity } | When entity is created |

---

## Events Listened

| Event | Handler | Description |
|-------|---------|-------------|
| `[event]` | handleEvent() | Description |

---

## Related Documentation

- [Detailed Feature Documentation](../../docs/features/[FEATURE].md)
- [API Documentation](../../docs/api/README.md)
- [Architecture Guide](../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Troubleshooting

### Common Issues

**Issue 1:** [Problem description]
- **Solution:** [Fix]

**Issue 2:** [Problem description]
- **Solution:** [Fix]

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
```

---

#### Services Needing READMEs (9 files)

1. **`src/services/appointments/README.md`**
   - Purpose: Appointment scheduling with plugin architecture
   - Key Features: 14 plugins, queue management, recurring appointments
   - Link to: `docs/features/APPOINTMENTS_COMPLETE.md`

2. **`src/services/auth/README.md`**
   - Purpose: Authentication & authorization
   - Key Features: JWT, OTP, social auth, session management
   - Link to: `docs/DEVELOPER_GUIDE.md` (auth section)

3. **`src/services/billing/README.md`**
   - Purpose: Billing, invoicing, payments
   - Key Features: Payment gateways, subscriptions, invoice PDF, WhatsApp delivery
   - Link to: `docs/features/PAYMENT_BILLING_COMPLETE.md`

4. **`src/services/clinic/README.md`**
   - Purpose: Multi-tenant clinic management
   - Key Features: Clinic CRUD, locations, staff management
   - Link to: `docs/architecture/SYSTEM_ARCHITECTURE.md`

5. **`src/services/ehr/README.md`**
   - Purpose: Electronic Health Records
   - Key Features: 10 record types, analytics, HIPAA compliance
   - Link to: `docs/features/AYURVEDIC_ENHANCEMENTS.md`

6. **`src/services/health/README.md`**
   - Purpose: System health monitoring
   - Key Features: 6 health indicators, metrics, diagnostics
   - Link to: `docs/architecture/SYSTEM_ARCHITECTURE.md`

7. **`src/services/notification/README.md`**
   - Purpose: REST API for notifications (deprecated, use CommunicationModule)
   - Key Features: Legacy endpoints, migration to CommunicationModule
   - Link to: `docs/features/NOTIFICATION_SYSTEM_IMPLEMENTATION.md`

8. **`src/services/users/README.md`**
   - Purpose: User management
   - Key Features: CRUD, role management, RBAC integration
   - Link to: `docs/features/RBAC_COMPLETE_IMPLEMENTATION.md`

9. **`src/services/video/README.md`**
   - Purpose: Video consultations
   - Key Features: OpenVidu Pro, recording, screen sharing, analytics
   - Link to: `docs/VIDEO_SERVICE.md`, `docs/OPENVIDU_PRO_SETUP.md`

---

#### Library Modules Needing READMEs (4 files)

10. **`src/libs/communication/README.md`**
    - Purpose: Multi-channel communication orchestration
    - Key Features: Email, WhatsApp, Push, Socket, multi-provider
    - Link to: `docs/features/MULTI_TENANT_COMMUNICATION.md`

11. **`src/libs/payment/README.md`**
    - Purpose: Payment gateway integration
    - Key Features: Razorpay, PhonePe, multi-provider abstraction
    - Link to: `docs/features/PAYMENT_BILLING_COMPLETE.md`

12. **`src/libs/security/README.md`**
    - Purpose: Security utilities
    - Key Features: Encryption, hashing, sanitization, rate limiting
    - Link to: `docs/DEVELOPER_GUIDE.md`

13. **`src/libs/core/README.md`**
    - Purpose: Core utilities and types
    - Key Features: Types, guards, decorators, RBAC, business rules
    - Link to: `docs/DEVELOPER_GUIDE.md`, `docs/features/RBAC_COMPLETE_IMPLEMENTATION.md`

14. **`src/config/README.md`**
    - Purpose: Enhanced configuration service
    - Key Features: Type-safe config, environment validation, multi-env support
    - Link to: `docs/CENTRAL_CONFIG_GUIDE.md`

---

#### Infrastructure Services Needing READMEs (8 files)

**Note:** These individual READMEs complement the consolidated `src/INFRASTRUCTURE_DOCUMENTATION.md`. Each README focuses on:
- Service-specific usage and API
- Quick start examples
- Common patterns and best practices
- Troubleshooting
- Links to consolidated doc for architecture context

15. **`src/libs/infrastructure/database/README.md`**
    - **Purpose:** Unified database service with Prisma
    - **Key Features:** Multi-tenant isolation, read replicas, query optimization, HIPAA compliance, transaction management
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Database section)
    - **Focus:** How to use DatabaseService, execute queries, manage transactions, handle multi-tenancy

16. **`src/libs/infrastructure/cache/README.md`**
    - **Purpose:** Multi-provider cache service (Dragonfly, Redis, Memory)
    - **Key Features:** Cache strategies, versioning, warming, feature flags, health monitoring
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Cache section)
    - **Focus:** Cache patterns, TTL management, invalidation strategies, provider selection

17. **`src/libs/infrastructure/logging/README.md`**
    - **Purpose:** Structured logging service
    - **Key Features:** Log levels, context, health monitoring, interceptors, audit logging
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Logging section)
    - **Focus:** How to log, log levels, context propagation, structured logging patterns

18. **`src/libs/infrastructure/events/README.md`**
    - **Purpose:** Event-driven architecture service
    - **Key Features:** Event emission, listeners, async processing, event patterns
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Events section)
    - **Additional Link:** `docs/architecture/EVENT_INTEGRATION.md`
    - **Focus:** How to emit/listen to events, event patterns, async processing

19. **`src/libs/infrastructure/queue/README.md`**
    - **Purpose:** Background job queue service (BullMQ)
    - **Key Features:** Job queues, workers, repeatable jobs, rate limiting, job priorities
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Queue section)
    - **Additional Link:** `docs/features/QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md`
    - **Focus:** How to create jobs, workers, repeatable jobs, job monitoring

20. **`src/libs/infrastructure/framework/README.md`**
    - **Purpose:** Fastify framework adapter and lifecycle management
    - **Key Features:** Fastify integration, middleware management, route registration, hooks
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Framework section)
    - **Focus:** How to register routes, middleware, hooks, lifecycle management

21. **`src/libs/infrastructure/search/README.md`**
    - **Purpose:** Full-text search service (Elasticsearch)
    - **Key Features:** Search indexing, fuzzy matching, database fallback, query building
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Search section)
    - **Focus:** How to index documents, search queries, fallback behavior

22. **`src/libs/infrastructure/storage/README.md`**
    - **Purpose:** File storage service (S3)
    - **Key Features:** S3 integration, static asset management, file uploads, CDN
    - **Consolidated Doc Link:** `src/INFRASTRUCTURE_DOCUMENTATION.md` (Storage section)
    - **Additional Link:** `docs/guides/STORAGE_CONFIGURATION.md`
    - **Focus:** How to upload/download files, manage buckets, static assets

---

### Phase 3.5: Update Consolidated Infrastructure Documentation

**Update:** `src/INFRASTRUCTURE_DOCUMENTATION.md`

Add links to individual service READMEs at the beginning of each service section:

```markdown
## Database Service

> **📖 Individual Service Documentation:** [Database Service README](./libs/infrastructure/database/README.md)  
> This section provides architecture overview. For usage examples and API reference, see the individual README.

[Existing consolidated content...]
```

**Purpose:** 
- Consolidated doc provides architecture, design decisions, cross-service patterns
- Individual READMEs provide usage, examples, troubleshooting
- Both link to each other for complete understanding

---

### Phase 4: Update Documentation Hub

**Update:** `docs/README.md`

Add service documentation section:

```markdown
# Healthcare Backend Documentation

## Service Documentation

Quick links to service-level documentation:

### Domain Services
- [Appointments Service](../src/services/appointments/README.md) - Appointment scheduling & plugins
- [Auth Service](../src/services/auth/README.md) - Authentication & authorization
- [Billing Service](../src/services/billing/README.md) - Billing, invoicing, payments
- [Clinic Service](../src/services/clinic/README.md) - Multi-tenant clinic management
- [EHR Service](../src/services/ehr/README.md) - Electronic Health Records
- [Health Service](../src/services/health/README.md) - System health monitoring
- [Notification Service](../src/services/notification/README.md) - Notifications (legacy)
- [Users Service](../src/services/users/README.md) - User management
- [Video Service](../src/services/video/README.md) - Video consultations

### Infrastructure Libraries
- [Communication Module](../src/libs/communication/README.md) - Multi-channel communication
- [Payment Module](../src/libs/payment/README.md) - Payment gateway integration
- [Security Module](../src/libs/security/README.md) - Security utilities
- [Core Module](../src/libs/core/README.md) - Core utilities & types
- [Configuration](../src/config/README.md) - Enhanced configuration service

### Infrastructure Services
- [Database Service](../src/libs/infrastructure/database/README.md) - Unified database service with Prisma
- [Cache Service](../src/libs/infrastructure/cache/README.md) - Multi-provider cache (Dragonfly, Redis, Memory)
- [Logging Service](../src/libs/infrastructure/logging/README.md) - Structured logging
- [Event Service](../src/libs/infrastructure/events/README.md) - Event-driven architecture
- [Queue Service](../src/libs/infrastructure/queue/README.md) - Background job queues (BullMQ)
- [Framework Service](../src/libs/infrastructure/framework/README.md) - Fastify adapter & lifecycle
- [Search Service](../src/libs/infrastructure/search/README.md) - Full-text search (Elasticsearch)
- [Storage Service](../src/libs/infrastructure/storage/README.md) - File storage (S3)

### Consolidated Infrastructure
- [Infrastructure Documentation](../src/INFRASTRUCTURE_DOCUMENTATION.md) - Complete infrastructure overview

## Architecture Documentation
[Rest of existing content...]
```

---

## File Operations

### Files to Delete (9 files)

```bash
# Phase 1: Duplicates
rm docs/features/APPOINTMENTS_README.md
rm docs/INTEGRATION_VERIFICATION.md
rm docs/architecture/INTEGRATION_VERIFICATION.md
rm docs/guides/AWS_QUICK_START.md
rm docs/guides/FCM_QUICK_START.md

# Phase 2: After consolidation
rm docs/features/MULTI_TENANT_COMMUNICATION_SOLUTION.md
rm docs/features/MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_COMPLETE.md
rm docs/features/MULTI_TENANT_COMMUNICATION_IMPLEMENTATION_STATUS.md
rm docs/features/DEVELOPER_DOCUMENTATION.md
```

### Files to Create (22 new files)

```bash
# Domain Services (9 files)
touch src/services/appointments/README.md
touch src/services/auth/README.md
touch src/services/billing/README.md
touch src/services/clinic/README.md
touch src/services/ehr/README.md
touch src/services/health/README.md
touch src/services/notification/README.md
touch src/services/users/README.md
touch src/services/video/README.md

# Library Modules (4 files)
touch src/libs/communication/README.md
touch src/libs/payment/README.md
touch src/libs/security/README.md
touch src/libs/core/README.md

# Configuration (1 file)
touch src/config/README.md

# Infrastructure Services (8 files) ⭐ CRITICAL
touch src/libs/infrastructure/database/README.md
touch src/libs/infrastructure/cache/README.md
touch src/libs/infrastructure/logging/README.md
touch src/libs/infrastructure/events/README.md
touch src/libs/infrastructure/queue/README.md
touch src/libs/infrastructure/framework/README.md
touch src/libs/infrastructure/search/README.md
touch src/libs/infrastructure/storage/README.md
```

**Note:** Infrastructure service READMEs complement the consolidated `src/INFRASTRUCTURE_DOCUMENTATION.md`:
- **Individual READMEs**: Service-specific usage, quick start, examples, troubleshooting
- **Consolidated Doc**: Architecture overview, design decisions, cross-service patterns
- **Both link to each other** for complete understanding

### Files to Consolidate (8 → 2 new files)

```bash
# Create consolidated files (after merging content)
touch docs/features/MULTI_TENANT_COMMUNICATION.md
touch docs/architecture/EVENT_INTEGRATION.md
```

### Files to Update (4 files)

```bash
# Merge additional content
# docs/DEVELOPER_GUIDE.md (add RBAC patterns)
# docs/guides/AWS_SES_INTEGRATION_GUIDE.md (add quick start section)
# docs/guides/FCM_INTEGRATION_GUIDE.md (add quick start section)
# docs/README.md (add service documentation links)

# Update consolidated infrastructure doc
# src/INFRASTRUCTURE_DOCUMENTATION.md (add links to individual READMEs at start of each service section)
```

---

## Service README Templates

### Template 1: Appointments Service README

```markdown
# Appointments Service

**Purpose:** Appointment scheduling with extensible plugin architecture
**Location:** `src/services/appointments`
**Status:** Production-ready

---

## Quick Start

### Basic Usage
```typescript
import { AppointmentsService } from '@services/appointments';

@Injectable()
export class MyService {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  async scheduleAppointment() {
    const appointment = await this.appointmentsService.create({
      patientId: 'patient-123',
      doctorId: 'doctor-456',
      clinicId: 'clinic-789',
      scheduledAt: new Date('2025-12-20T10:00:00Z'),
      type: 'CONSULTATION',
      duration: 30,
    });
    return appointment;
  }
}
```

---

## Key Features

- ✅ **Plugin Architecture** - 14 specialized plugins for extensibility
- ✅ **Queue Management** - Clinic queue optimization
- ✅ **Recurring Appointments** - Support for recurring patterns
- ✅ **Video Integration** - Telemedicine consultation support
- ✅ **Payment Processing** - Integrated payment flows
- ✅ **Multi-Channel Notifications** - Email, WhatsApp, Push, Socket
- ✅ **Analytics** - Appointment analytics and reporting
- ✅ **Compliance** - Regulatory compliance checks
- ✅ **Conflict Resolution** - Automatic schedule conflict detection

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/api/appointments/plugins/info` | GET | SUPER_ADMIN, CLINIC_ADMIN | Get plugin information |
| `/api/appointments/plugins/execute` | POST | SUPER_ADMIN, CLINIC_ADMIN | Execute plugin |
| `/api/appointments/plugins/config/:name` | GET/POST | SUPER_ADMIN, CLINIC_ADMIN | Plugin configuration |

[Full API documentation](../../docs/api/README.md)
[API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Architecture

```
AppointmentsModule
├── controllers/
│   └── plugin.controller.ts
├── services/
│   ├── appointments.service.ts
│   └── core-appointment.service.ts
├── plugins/ (14 plugins)
│   ├── notification.plugin.ts
│   ├── reminder.plugin.ts
│   ├── queue-management.plugin.ts
│   ├── payment.plugin.ts
│   ├── video-consultation.plugin.ts
│   ├── check-in.plugin.ts
│   ├── waitlist.plugin.ts
│   ├── therapy-scheduling.plugin.ts
│   ├── follow-up.plugin.ts
│   ├── recurring-appointment.plugin.ts
│   ├── bulk-operations.plugin.ts
│   ├── analytics.plugin.ts
│   ├── compliance.plugin.ts
│   └── conflict-resolution.plugin.ts
├── engines/
│   ├── business-rules.engine.ts
│   └── workflow.engine.ts
└── dtos/
    ├── create-appointment.dto.ts
    └── update-appointment.dto.ts
```

---

## Available Plugins (14)

1. **NotificationPlugin** - Send appointment notifications (Email, WhatsApp, Push, Socket)
2. **ReminderPlugin** - Automated appointment reminders
3. **QueueManagementPlugin** - Clinic queue optimization
4. **PaymentPlugin** - Payment processing integration
5. **VideoConsultationPlugin** - Telemedicine integration
6. **CheckInPlugin** - Patient check-in workflow
7. **WaitlistPlugin** - Waitlist management
8. **TherapySchedulingPlugin** - Therapy session scheduling
9. **FollowUpPlugin** - Automated follow-up scheduling
10. **RecurringAppointmentPlugin** - Recurring appointment patterns
11. **BulkOperationsPlugin** - Batch appointment operations
12. **AnalyticsPlugin** - Appointment analytics
13. **CompliancePlugin** - Regulatory compliance checks
14. **ConflictResolutionPlugin** - Schedule conflict resolution

---

## Usage Examples

### Example 1: Create Appointment with Plugins
```typescript
import { AppointmentsService, PluginManager } from '@services/appointments';

async createAppointmentWithNotification() {
  // Create appointment
  const appointment = await this.appointmentsService.create({
    patientId: 'patient-123',
    doctorId: 'doctor-456',
    scheduledAt: new Date('2025-12-20T10:00:00Z'),
    type: 'CONSULTATION',
  });

  // Plugins automatically execute (notification, queue, etc.)
  // via lifecycle hooks
}
```

### Example 2: Execute Plugin Manually
```typescript
import { PluginManager } from '@services/appointments';

async executePlugin() {
  const result = await this.pluginManager.execute('notification', {
    appointmentId: 'appointment-123',
    channels: ['email', 'whatsapp', 'push'],
  });
}
```

### Example 3: Schedule Recurring Appointment
```typescript
async scheduleRecurring() {
  const appointment = await this.appointmentsService.create({
    patientId: 'patient-123',
    doctorId: 'doctor-456',
    scheduledAt: new Date('2025-12-20T10:00:00Z'),
    type: 'THERAPY',
    duration: 60,
    recurringPattern: {
      frequency: 'weekly',
      interval: 1,
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      endDate: new Date('2026-03-20'),
    },
  });
}
```

---

## Testing

```bash
# Run appointment service tests
pnpm test appointments

# Run plugin tests
pnpm test appointments/plugins
```

---

## Dependencies

### Required Services
- DatabaseService
- LoggingService
- EventService
- CacheService
- QueueService

### Optional Services
- VideoService (for video consultations)
- PaymentService (for payment processing)
- CommunicationService (for notifications)

---

## Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `appointment.created` | { appointment } | When appointment is created |
| `appointment.updated` | { appointment } | When appointment is updated |
| `appointment.cancelled` | { appointment } | When appointment is cancelled |
| `appointment.rescheduled` | { appointment, oldDate } | When appointment is rescheduled |
| `appointment.confirmed` | { appointment } | When appointment is confirmed |
| `appointment.completed` | { appointment } | When appointment is completed |

---

## Events Listened

| Event | Handler | Description |
|-------|---------|-------------|
| `payment.completed` | handlePaymentCompleted() | Confirm appointment after payment |
| `video.session.ended` | handleVideoEnded() | Mark appointment complete after video |

---

## Related Documentation

- [Appointments Feature Guide](../../docs/features/APPOINTMENTS_COMPLETE.md)
- [Queue Integration Guide](../../docs/features/QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md)
- [Subscription Appointments](../../docs/features/SUBSCRIPTION_APPOINTMENTS.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)
- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)

---

## Troubleshooting

### Common Issues

**Issue 1: Plugin Not Executing**
- **Cause:** Plugin not registered in PluginRegistry
- **Solution:** Ensure plugin is added to `plugins/` folder and imported in module

**Issue 2: Queue Conflicts**
- **Cause:** Multiple appointments scheduled at same time
- **Solution:** Enable ConflictResolutionPlugin to automatically detect and prevent conflicts

**Issue 3: Notifications Not Sent**
- **Cause:** NotificationPlugin configuration missing
- **Solution:** Configure notification channels in plugin config

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
```

---

### Template 2: Auth Service README

```markdown
# Auth Service

**Purpose:** Authentication & authorization with JWT, OTP, and social auth
**Location:** `src/services/auth`
**Status:** Production-ready

---

## Quick Start

### Basic Usage
```typescript
import { AuthService } from '@services/auth';

@Injectable()
export class MyService {
  constructor(private readonly authService: AuthService) {}

  async login(email: string, password: string) {
    const result = await this.authService.login({ email, password });
    return result; // { accessToken, refreshToken, user }
  }
}
```

---

## Key Features

- ✅ **JWT Authentication** - Access & refresh tokens
- ✅ **Session Management** - Max 5 concurrent sessions per user
- ✅ **Progressive Lockout** - 10m → 25m → 45m → 1h → 6h
- ✅ **OTP-based 2FA** - Email/SMS OTP verification
- ✅ **Social Authentication** - Google OAuth integration
- ✅ **Password Management** - Forgot password, reset password, change password
- ✅ **Device Fingerprinting** - Track sessions by device
- ✅ **Rate Limiting** - Prevent brute force attacks

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/auth/register` | POST | Public | User registration |
| `/auth/login` | POST | Public | User login |
| `/auth/refresh` | POST | Public | Refresh access token |
| `/auth/logout` | POST | Authenticated | User logout |
| `/auth/forgot-password` | POST | Public | Request password reset |
| `/auth/reset-password` | POST | Public | Reset password with token |
| `/auth/change-password` | POST | Authenticated | Change password |
| `/auth/request-otp` | POST | Public | Request OTP |
| `/auth/verify-otp` | POST | Public | Verify OTP |
| `/auth/google` | POST | Public | Google OAuth login |
| `/auth/sessions` | GET | Authenticated | Get active sessions |

[Full API documentation](../../docs/api/README.md)

---

## Architecture

```
AuthModule
├── controllers/
│   └── auth.controller.ts
├── services/
│   ├── auth.service.ts
│   ├── jwt-auth.service.ts
│   ├── otp.service.ts
│   ├── password.service.ts
│   ├── session.service.ts
│   └── social-auth.service.ts
├── guards/
│   └── jwt-auth.guard.ts (in core/guards)
├── strategies/
│   └── jwt.strategy.ts
└── dtos/
    ├── login.dto.ts
    ├── register.dto.ts
    └── change-password.dto.ts
```

---

## Usage Examples

### Example 1: User Registration
```typescript
const result = await this.authService.register({
  email: 'user@example.com',
  password: 'SecurePass123!',
  name: 'John Doe',
  role: 'PATIENT',
});
// Returns: { user, accessToken, refreshToken }
```

### Example 2: Login with OTP
```typescript
// Step 1: Request OTP
await this.authService.requestOtp({ email: 'user@example.com' });

// Step 2: Verify OTP
const result = await this.authService.verifyOtp({
  email: 'user@example.com',
  otp: '123456',
});
// Returns: { accessToken, refreshToken, user }
```

### Example 3: Session Management
```typescript
// Get active sessions
const sessions = await this.authService.getSessions(userId);

// Logout from specific session
await this.authService.logout(userId, sessionId);

// Logout from all sessions
await this.authService.logoutAll(userId);
```

---

## Configuration

### Environment Variables

```env
# JWT Configuration
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Session Configuration
MAX_CONCURRENT_SESSIONS=5
SESSION_INACTIVITY_THRESHOLD=15m

# OTP Configuration
OTP_EXPIRES_IN=5m

# Rate Limiting
AUTH_RATE_LIMIT_MAX_ATTEMPTS=10
AUTH_RATE_LIMIT_WINDOW=30m
```

[Full environment variables guide](../../docs/ENVIRONMENT_VARIABLES.md)

---

## Security Features

### Progressive Lockout
- 1st lockout: 10 minutes
- 2nd lockout: 25 minutes
- 3rd lockout: 45 minutes
- 4th lockout: 1 hour
- 5th+ lockout: 6 hours

### Session Management
- Maximum 5 concurrent sessions per user
- Automatic cleanup of oldest session when limit exceeded
- Device fingerprinting for session tracking
- Suspicious session detection every 30 minutes

### Rate Limiting
- Login: 10 attempts per 30 minutes
- OTP: 5 requests per 15 minutes
- Password reset: 3 requests per hour

---

## Testing

```bash
# Run auth service tests
pnpm test auth
```

---

## Dependencies

### Required Services
- DatabaseService
- LoggingService
- EventService
- CacheService
- RbacService

### Optional Services
- EmailService (for password reset emails)
- SmsService (for OTP via SMS)

---

## Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `user.registered` | { user } | When new user registers |
| `user.login` | { userId, sessionId } | When user logs in |
| `user.logout` | { userId, sessionId } | When user logs out |
| `auth.password.changed` | { userId } | When password is changed |
| `auth.session.suspicious` | { userId, sessionId } | When suspicious activity detected |

---

## Related Documentation

- [RBAC Implementation](../../docs/features/RBAC_COMPLETE_IMPLEMENTATION.md)
- [Developer Guide](../../docs/DEVELOPER_GUIDE.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Troubleshooting

### Common Issues

**Issue 1: Token Expired**
- **Solution:** Use refresh token endpoint to get new access token

**Issue 2: Account Locked**
- **Solution:** Wait for lockout period to expire or contact admin

**Issue 3: OTP Not Received**
- **Solution:** Check email spam folder or request new OTP

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
```

---

### Template 3: Infrastructure Service README (Database Example)

```markdown
# Database Service

**Purpose:** Unified database service with Prisma, multi-tenant isolation, and HIPAA compliance
**Location:** `src/libs/infrastructure/database`
**Status:** Production-ready

---

## Quick Start

### Installation

```bash
# No separate installation - part of main project
pnpm install
```

### Basic Usage

```typescript
import { DatabaseService } from '@database';

@Injectable()
export class MyService {
  constructor(private readonly databaseService: DatabaseService) {}

  async example() {
    // Execute read query with multi-tenant isolation
    const result = await this.databaseService.executeHealthcareRead(
      async (client) => {
        return await client.user.findMany({
          where: { clinicId: 'clinic-123' },
        });
      }
    );

    // Execute write query with transaction
    await this.databaseService.executeHealthcareWrite(
      async (client) => {
        return await client.user.create({
          data: { email: 'user@example.com', clinicId: 'clinic-123' },
        });
      }
    );
  }
}
```

---

## Key Features

- ✅ **Multi-Tenant Isolation** - Automatic clinic-based data isolation
- ✅ **Read Replicas** - Automatic read/write splitting for performance
- ✅ **Transaction Management** - ACID-compliant transactions
- ✅ **Query Optimization** - Built-in query performance monitoring
- ✅ **HIPAA Compliance** - Audit logging and data encryption
- ✅ **Connection Pooling** - Efficient connection management
- ✅ **Health Monitoring** - Database health checks

---

## Architecture

```
DatabaseModule
├── database.service.ts (Main service)
├── database.module.ts
├── types/
│   └── database.types.ts
└── utils/
    └── query-optimizer.ts
```

**Consolidated Documentation:**
- [Complete Infrastructure Documentation](../../INFRASTRUCTURE_DOCUMENTATION.md#database-service) - Architecture, design decisions, cross-service patterns

---

## Usage Examples

### Example 1: Read Query with Multi-Tenant Isolation

```typescript
import { DatabaseService } from '@database';

async getUserData(userId: string, clinicId: string) {
  return await this.databaseService.executeHealthcareRead(
    async (client) => {
      // Automatically scoped to clinicId
      return await client.user.findUnique({
        where: {
          id: userId,
          clinicId, // Multi-tenant isolation
        },
        include: {
          appointments: true,
        },
      });
    }
  );
}
```

### Example 2: Write Query with Transaction

```typescript
async createUserWithProfile(userData: UserData, profileData: ProfileData) {
  return await this.databaseService.executeHealthcareWrite(
    async (client) => {
      // Transaction - both succeed or both fail
      return await client.$transaction(async (tx) => {
        const user = await tx.user.create({ data: userData });
        const profile = await tx.profile.create({
          data: { ...profileData, userId: user.id },
        });
        return { user, profile };
      });
    }
  );
}
```

### Example 3: Read Replica for Analytics

```typescript
async getAnalytics(clinicId: string) {
  // Automatically uses read replica for read-only queries
  return await this.databaseService.executeHealthcareRead(
    async (client) => {
      return await client.appointment.groupBy({
        by: ['status'],
        where: { clinicId },
        _count: true,
      });
    }
  );
}
```

---

## Configuration

### Environment Variables

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/healthcare
DATABASE_READ_REPLICA_URL=postgresql://user:password@replica:5432/healthcare
DATABASE_POOL_SIZE=10
DATABASE_CONNECTION_TIMEOUT=5000
DATABASE_QUERY_TIMEOUT=30000

# Health Monitoring
DATABASE_HEALTH_CHECK_INTERVAL=60000
```

[Full environment variables guide](../../../docs/ENVIRONMENT_VARIABLES.md)

---

## Multi-Tenant Isolation

The DatabaseService automatically enforces multi-tenant isolation:

1. **Automatic Clinic Scoping**: All queries are scoped to the current clinic context
2. **Row-Level Security**: Database-level RLS policies (if enabled)
3. **Query Filtering**: Automatic `clinicId` filtering in queries
4. **Audit Logging**: All queries logged with clinic context

### How It Works

```typescript
// When you call executeHealthcareRead/Write, the service:
// 1. Extracts clinicId from context (ClinicGuard, request metadata)
// 2. Automatically adds clinicId filter to queries
// 3. Logs query with clinic context for audit
// 4. Uses read replica for read-only queries
```

---

## Transaction Management

### Simple Transaction

```typescript
await this.databaseService.executeHealthcareWrite(async (client) => {
  return await client.$transaction(async (tx) => {
    // All operations in transaction
    await tx.user.create({ data: userData });
    await tx.profile.create({ data: profileData });
  });
});
```

### Nested Transactions

```typescript
await this.databaseService.executeHealthcareWrite(async (client) => {
  return await client.$transaction(async (tx) => {
    // Outer transaction
    const user = await tx.user.create({ data: userData });
    
    await tx.$transaction(async (innerTx) => {
      // Nested transaction (savepoint)
      await innerTx.profile.create({ data: { ...profileData, userId: user.id } });
    });
    
    return user;
  });
});
```

---

## Query Optimization

### Built-in Optimization

- **Connection Pooling**: Reuses connections efficiently
- **Read Replicas**: Automatic read/write splitting
- **Query Timeout**: Prevents long-running queries
- **Query Monitoring**: Tracks slow queries

### Best Practices

1. **Use Read Replicas**: Use `executeHealthcareRead` for read-only queries
2. **Batch Operations**: Group multiple operations in transactions
3. **Index Usage**: Ensure proper indexes on frequently queried fields
4. **Select Specific Fields**: Use `select` instead of `include` when possible

---

## Health Monitoring

### Health Check

```typescript
const health = await this.databaseService.getHealthStatus();
// Returns: { status: 'healthy' | 'degraded' | 'down', latency: number }
```

### Metrics

- Connection pool utilization
- Query latency (P50, P95, P99)
- Error rate
- Read replica lag

---

## Testing

```bash
# Run database service tests
pnpm test infrastructure/database

# Run with test database
DATABASE_URL=postgresql://localhost:5432/healthcare_test pnpm test
```

---

## Dependencies

### Required Services
- Prisma Client
- LoggingService (for query logging)
- CacheService (for query result caching)

### Optional Services
- EventService (for database events)

---

## Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `database.query.slow` | { query, duration, clinicId } | When query exceeds threshold |
| `database.connection.pool.exhausted` | { poolSize, activeConnections } | When connection pool is full |
| `database.health.degraded` | { status, latency } | When database health degrades |

---

## Related Documentation

- [Complete Infrastructure Documentation](../../INFRASTRUCTURE_DOCUMENTATION.md#database-service) - Architecture overview, design decisions
- [Database Guidelines](../../../.ai-rules/database.md) - Database best practices
- [Multi-Tenant Architecture](../../../.ai-rules/architecture.md) - Multi-tenancy patterns
- [System Architecture](../../../docs/architecture/SYSTEM_ARCHITECTURE.md) - Overall system design

---

## Troubleshooting

### Common Issues

**Issue 1: Connection Pool Exhausted**
- **Cause:** Too many concurrent connections
- **Solution:** Increase `DATABASE_POOL_SIZE` or optimize connection usage

**Issue 2: Slow Queries**
- **Cause:** Missing indexes or inefficient queries
- **Solution:** Check query execution plan, add indexes, optimize query

**Issue 3: Read Replica Lag**
- **Cause:** High write load or network latency
- **Solution:** Monitor replica lag, consider additional replicas

**Issue 4: Multi-Tenant Isolation Not Working**
- **Cause:** Missing `clinicId` in context
- **Solution:** Ensure `ClinicGuard` is applied or `clinicId` is in request metadata

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
```

**Note:** This template can be adapted for other infrastructure services (cache, logging, events, queue, framework, search, storage) by changing:
- Service name and purpose
- Key features specific to that service
- Usage examples relevant to that service
- Configuration variables
- Service-specific troubleshooting

---

## Validation Checklist

After completing the reorganization, validate:

### Documentation Quality
- [ ] All services have README files
- [ ] All READMEs follow consistent template
- [ ] No duplicate content across files
- [ ] All links work correctly
- [ ] Code examples are accurate and tested

### Discoverability
- [ ] docs/README.md lists all service READMEs
- [ ] Service READMEs link to detailed docs in docs/
- [ ] Cross-references are consistent
- [ ] Navigation is intuitive

### Completeness
- [ ] All 9 domain services have READMEs
- [ ] All 4 library modules have READMEs
- [ ] Config module has README
- [ ] All 8 infrastructure services have READMEs
  - [ ] Database Service README
  - [ ] Cache Service README
  - [ ] Logging Service README
  - [ ] Events Service README
  - [ ] Queue Service README
  - [ ] Framework Service README
  - [ ] Search Service README
  - [ ] Storage Service README
- [ ] Infrastructure documentation consolidated (`src/INFRASTRUCTURE_DOCUMENTATION.md`)
- [ ] Individual infrastructure READMEs link to consolidated doc
- [ ] Consolidated doc links to individual READMEs

### Consolidation
- [ ] Duplicate files deleted (9 files)
- [ ] Multi-tenant communication consolidated (3 → 1)
- [ ] Event documentation consolidated (2 → 1)
- [ ] Developer guide enhanced with RBAC content
- [ ] Quick starts merged into main guides

### File Count Validation

**Before Reorganization:**
- Total markdown files: 54
- Service READMEs: 0
- Duplicate files: ~15

**After Reorganization:**
- Total markdown files: ~61 (delete 9, create 22, consolidate 8→2)
- Service READMEs: 22 (9 domain + 4 library + 8 infrastructure + 1 config)
- Duplicate files: 0

### Navigation Test
- [ ] From service folder → Can find service README
- [ ] From service README → Can navigate to detailed docs
- [ ] From docs/README.md → Can find all documentation
- [ ] From API documentation → Can find service implementation
- [ ] From infrastructure service README → Can navigate to consolidated infrastructure doc
- [ ] From consolidated infrastructure doc → Can navigate to individual service READMEs

---

## Timeline Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1: Delete Duplicates** | Delete 6 files | 30 minutes |
| **Phase 2: Consolidate** | Merge 8 files into 2 | 4-6 hours |
| **Phase 3: Create Service READMEs** | Write 22 README files | 12-18 hours |
| **Phase 3.5: Update Infrastructure Doc** | Add links to individual READMEs | 1 hour |
| **Phase 4: Update Documentation Hub** | Update docs/README.md | 1 hour |
| **Phase 5: Validation** | Test all links, validate content | 2-3 hours |
| **Total** | | **21-30 hours** |

---

## Success Metrics

After reorganization:

1. **Discoverability:** Developers can find service documentation in < 30 seconds
2. **Consistency:** All service READMEs follow same structure
3. **Completeness:** 100% of services have documentation
4. **Duplication:** 0 duplicate files
5. **Navigation:** All cross-references work correctly
6. **Maintainability:** Clear ownership of documentation per service

---

## Next Steps

1. **Review this plan** with team
2. **Get approval** for file deletions and consolidations
3. **Execute Phase 1** (delete duplicates) - Low risk
4. **Execute Phase 2** (consolidate files) - Moderate risk, review merged content
5. **Execute Phase 3** (create service READMEs) - No risk, new files
6. **Execute Phase 4** (update hub) - Low risk
7. **Execute Phase 5** (validation) - Quality assurance

---

**End of Plan**
