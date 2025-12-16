# Healthcare Backend Documentation

**Date**: 2024  
**Status**: ✅ **CONSOLIDATED DOCUMENTATION**

---

## 📚 Documentation Structure

This directory contains all documentation for the Healthcare Backend system, organized by category.

---

## 📖 Core Documentation

### 1. API Documentation
**File**: `docs/API_DOCUMENTATION.md`

Comprehensive API documentation including:
- API inventory (~250+ endpoints)
- Security status (100% secured)
- API optimization status
- RBAC analysis
- Service integration status

### 2. Implementation Status
**File**: `docs/features/IMPLEMENTATION_STATUS.md`

Tracks implementation of all high and medium priority items:
- Security enhancements
- Queue integration
- Event emissions
- Notification preferences
- Delivery tracking

---

## 🔧 Feature Documentation

### Developer Documentation
**File**: `docs/features/DEVELOPER_DOCUMENTATION.md`

Complete developer guide including:
- RBAC patterns and examples
- API integration guide
- Code examples for common patterns
- Architecture patterns

### Event System
**File**: `docs/features/EVENT_DOCUMENTATION.md`

Comprehensive event system documentation:
- 45+ event types
- Event payload structures
- Event patterns and best practices
- HIPAA compliance

### Payment & Billing
**File**: `docs/features/PAYMENT_BILLING_COMPLETE.md`

Complete payment system documentation:
- Payment providers (Razorpay, PhonePe)
- Payment flows
- API endpoints
- Future enhancements plan

### Queue Integration
**File**: `docs/features/QUEUE_INTEGRATION_IMPLEMENTATION_GUIDE.md`

Queue integration guide:
- Queue patterns
- Implementation examples
- Best practices

---

## 🏗️ Infrastructure Documentation

**Consolidated File**: `src/INFRASTRUCTURE_DOCUMENTATION.md`

Infrastructure components documentation:
- Configuration module
- Database infrastructure (10M+ users optimized)
- Cache system (Redis/Dragonfly, SWR pattern)
- Logging service (HIPAA-compliant)
- Event system (central event hub)
- Queue system (19 specialized queues)
- Framework abstraction (Fastify)
- Storage service (S3 integration)
- Search service (Elasticsearch)
- Communication module (5 channels)

---

## 🔌 Service Documentation

Individual service READMEs with detailed usage examples and configuration.

### Infrastructure Services

1. **[Database Service](../src/libs/infrastructure/database/README.md)** - Multi-tenant database with connection pooling, optimized for 10M+ users
2. **[Cache Service](../src/libs/infrastructure/cache/README.md)** - Multi-layer caching with SWR pattern, Redis/Dragonfly support
3. **[Logging Service](../src/libs/infrastructure/logging/README.md)** - HIPAA-compliant structured logging with PHI masking
4. **[Event Service](../src/libs/infrastructure/events/README.md)** - Central event hub with rate limiting and circuit breaker
5. **[Queue Service](../src/libs/infrastructure/queue/README.md)** - 19 specialized BullMQ queues for async processing
6. **[Framework Service](../src/libs/infrastructure/framework/README.md)** - Fastify abstraction layer for application bootstrap
7. **[Storage Service](../src/libs/infrastructure/storage/README.md)** - S3 object storage with pre-signed URLs
8. **[Search Service](../src/libs/infrastructure/search/README.md)** - Elasticsearch full-text search with fuzzy matching

### Domain Services

1. **[Auth Service](../src/services/auth/README.md)** - Authentication with JWT, OTP, social auth, progressive lockout
2. **[Appointments Service](../src/services/appointments/README.md)** - Plugin architecture with 14 plugins, recurring appointments
3. **[Users Service](../src/services/users/README.md)** - User management with RBAC integration, 12 healthcare roles
4. **[EHR Service](../src/services/ehr/README.md)** - Electronic Health Records with 10 record types
5. **[Billing Service](../src/services/billing/README.md)** - Payment processing, invoicing, PDF generation
6. **[Video Service](../src/services/video/README.md)** - OpenVidu Pro integration for video consultations
7. **[Clinic Service](../src/services/clinic/README.md)** - Multi-tenant clinic management with multi-location support
8. **[Health Service](../src/services/health/README.md)** - System health monitoring with 6 indicators
9. **[Notification Service](../src/services/notification/README.md)** - DEPRECATED - Migrate to CommunicationModule

### Library Modules

1. **[Communication Module](../src/libs/communication/README.md)** - Multi-channel communication (Email, WhatsApp, Push, Socket, SMS)
2. **[Payment Module](../src/libs/payment/README.md)** - Multi-provider payment processing (Razorpay, PhonePe)
3. **[Security Module](../src/libs/security/README.md)** - Security middleware, rate limiting, CORS, Helmet
4. **[Core Library](../src/libs/core/README.md)** - Business rules engine, RBAC, session management, guards, decorators
5. **[Config Module](../src/config/README.md)** - Type-safe configuration with environment validation

---

## 📋 Quick Reference

### For API Integration
→ See [API Documentation](./API_DOCUMENTATION.md)

### For Implementation Status
→ See [Implementation Status](./features/IMPLEMENTATION_STATUS.md)

### For Developer Guide
→ See [Developer Documentation](./features/DEVELOPER_DOCUMENTATION.md)

### For Event System
→ See [Event Documentation](./features/EVENT_DOCUMENTATION.md)

### For Payment System
→ See [Payment & Billing](./features/PAYMENT_BILLING_COMPLETE.md)

### For Infrastructure Overview
→ See [Infrastructure Documentation](../src/INFRASTRUCTURE_DOCUMENTATION.md)

### For Service Usage Examples
→ See individual service READMEs in the [Service Documentation](#-service-documentation) section above

---

## 🔍 Finding Documentation

- **API endpoint usage**: Start with [API Documentation](./API_DOCUMENTATION.md)
- **Service usage examples**: See individual service READMEs (e.g., [Auth Service](../src/services/auth/README.md))
- **Infrastructure setup**: See [Infrastructure Documentation](../src/INFRASTRUCTURE_DOCUMENTATION.md)
- **Configuration**: See [Config Module](../src/config/README.md)
- **Event-driven patterns**: See [Event Documentation](./features/EVENT_DOCUMENTATION.md)
- **Payment integration**: See [Payment Module](../src/libs/payment/README.md)
- **Multi-channel notifications**: See [Communication Module](../src/libs/communication/README.md)

---

**Last Updated**: December 2024
**Status**: ✅ **DOCUMENTATION CONSOLIDATED & SERVICE READMES COMPLETE**
**Total Service READMEs**: 22 (8 Infrastructure + 9 Domain + 5 Library Modules)

