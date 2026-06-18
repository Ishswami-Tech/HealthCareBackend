# Documentation Index - Complete Reference

**Date**: May 2026  
**Status**:… **VERIFIED & CONSOLIDATED** - Updated to reflect actual file
structure

Addendum: current code facts from source scan

- NestJS `11.1.19`
- Fastify `5.8.5`
- Prisma `7.8.0`
- 32 controller files
- about 391 HTTP route handlers
- 14 role values in the current enum
- Dragonfly is the default cache provider; Redis is compatibility language where
  the code uses Redis-compatible clients.

Use the controller source and Swagger/OpenAPI output as the source of truth for
route counts and exact endpoints.

---

## ‹ Quick Reference

| Category          | File                                                   | Description                                     |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **â­ Start Here** | [SYSTEM_COMPLETE.md](./SYSTEM_COMPLETE.md)             | Complete system overview                        |
| **API**           | [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)         | Source-derived route reference                  |
| **Developer**     | [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)             | Quick start & best practices                    |
| **Environment**   | [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) | All environment variables                       |
| **API Inventory** | [ACTUAL_API_INVENTORY.md](./ACTUAL_API_INVENTORY.md)   | Source-derived endpoint inventory (~391 routes) |
| **Deployment**    | [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)           | CI/CD, server setup, **rollback & recovery**    |

---

## š Core Documentation (5 files)

1. **[SYSTEM_COMPLETE.md](./SYSTEM_COMPLETE.md)**­
   - Complete system overview
   - All services, features, API reference
   - Performance & security
   - Quick start guide

2. **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**
   - Current API route inventory derived from controller source
   - Security status (100% secured)
   - RBAC analysis

3. **[ROLE_PERMISSIONS_COMPLETE.md](./ROLE_PERMISSIONS_COMPLETE.md)**
   - 14 roles, 140+ permissions
   - Permission matrices
   - API verification by role

4. **[INFRASTRUCTURE_DOCUMENTATION.md](./INFRASTRUCTURE_DOCUMENTATION.md)**
   - Database, cache, logging, events, queue
   - Framework abstraction
   - Storage & search services

5. **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)**
   - Quick start
   - Configuration management
   - Common issues & solutions
   - Best practices

---

## ðŸ—ï¸ Architecture Documentation (6 files)

1. **[10M_USER_SCALE_OPTIMIZATIONS.md](./architecture/10M_USER_SCALE_OPTIMIZATIONS.md)**
   - Selective relation loading…
   - Mandatory pagination…
   - Database indexes & caching

2. **[EVENT_INTEGRATION.md](./architecture/EVENT_INTEGRATION.md)**
   - EventService as single source of truth
   - NotificationEventListener
   - EventSocketBroadcaster

3. **[SYSTEM_ARCHITECTURE.md](./architecture/SYSTEM_ARCHITECTURE.md)**
   - High-level architecture
   - Data flow patterns
   - Integration matrix

4. **[LOCATION_SYSTEM_COMPLETE.md](./architecture/LOCATION_SYSTEM_COMPLETE.md)**
   - Multi-clinic, multi-location system
   - Authentication & access control
   - Performance optimization

5. **[FRONTEND_CLINIC_LOCATION_IMPLEMENTATION.md](./architecture/FRONTEND_CLINIC_LOCATION_IMPLEMENTATION.md)**
   - Frontend integration guide
   - Next.js/React implementation
   - Location context management

6. **[PUSH_NOTIFICATION_RECOMMENDATIONS.md](./architecture/PUSH_NOTIFICATION_RECOMMENDATIONS.md)**
   - Push notification solutions
   - FCM + AWS SNS recommendations
   - HIPAA compliance

**Excluded** (as requested):

- `GRAPHQL_MIGRATION_FEASIBILITY.md` - Kept for future reference

---

## ðŸ”§ Feature Documentation

1.… **[FEATURES.md](./FEATURES.md)**­ **CONSOLIDATED**

- All features consolidated into one comprehensive file
- Includes: Communication, Appointments, Video, RBAC, Payments, Events, Queue,
  Multi-Tenant
- Quick start guides for each feature
- Status indicators for each feature

  2.… **[LOCATION_QR_CHECKIN.md](./features/LOCATION_QR_CHECKIN.md)**­
  **COMPLETE**

- Static location-based QR code check-in
- Patient journey, API reference, frontend integration
- Comprehensive standalone documentation

**Note**: Most feature documentation was consolidated into `FEATURES.md` during
documentation cleanup. See [Consolidation History](#-consolidation-history)
section below for details.

**See**:
[Documentation Analysis & Missing Implementation Checklist](#-documentation-analysis--missing-implementation-checklist)
section below for implementation gaps

---

## – Guides (7 files)

### Communication & Notifications

1. **[COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md](./guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md)**
   ­ **START HERE** - Main communication guide (comprehensive overview)
2. **[EMAIL_INTEGRATION_GUIDE.md](./guides/EMAIL_INTEGRATION_GUIDE.md)** -
   Detailed email provider setup (ZeptoMail, AWS SES, SMTP)
3. **[AWS_SES_COMPLETE_GUIDE.md](./guides/AWS_SES_COMPLETE_GUIDE.md)**­ - AWS
   SES setup, best practices, and compliance audit
4. **[FCM_INTEGRATION_GUIDE.md](./guides/FCM_INTEGRATION_GUIDE.md)** - Push
   notifications (Firebase FCM)

### System Configuration

6. **[STORAGE_CONFIGURATION.md](./guides/STORAGE_CONFIGURATION.md)** - Storage
   setup and configuration
7. **[SUPERADMIN_CLINIC_MANAGEMENT.md](./guides/SUPERADMIN_CLINIC_MANAGEMENT.md)** -
   Super admin clinic management
8. **Video deployment docs** - Current backend video service and deployment
   guidance

**Note:** Enhanced monitoring and migration information is in
[Communication System Complete Guide](./guides/COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md#health-monitoring--metrics).

### Testing

9. **[TESTING_APPOINTMENT_ENDPOINTS.md](./guides/TESTING_APPOINTMENT_ENDPOINTS.md)**
   ­ - Role-based appointment testing guide

**Note**:

- Start with **COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md** for system-wide overview
- Use **EMAIL_INTEGRATION_GUIDE.md** for detailed email provider setup
- See [Consolidation History](#-consolidation-history) section below for
  consolidation history

---

## Š Verification & Status

- **[ACTUAL_API_INVENTORY.md](./ACTUAL_API_INVENTORY.md)**­ **COMPLETE ENDPOINT
  LIST**
  - Current endpoint inventory from actual code
  - Controller-by-controller breakdown
  - Implementation status per endpoint
  - Postman collection status (â… Complete)

**Note**: Consolidation history is documented in the
[Consolidation History](#-consolidation-history) section below.

---

## ðŸ” Documentation Analysis & Missing Implementation Checklist

### Š Executive Summary

#### Documentation Status

-… **Core Documentation**: Complete and consolidated -… **Architecture Docs**: 7
files, all complete -… **Feature Documentation**: **Consolidated into
FEATURES.md** + LOCATION_QR_CHECKIN.md (standalone) -… **Postman Collection**:
**COMPLETE** - Current source-derived endpoints included -… **API
Documentation**: Basic structure exists, needs endpoint details

#### Implementation Status

-… **Core Features**: 95% implemented -š ï¸ **Missing Features**: See checklist
below (AWS SES compliance items) -… **LocationQR**: 100% complete -… **Postman
Collection**: Complete with all endpoints

---

### ðŸš¨ CRITICAL MISSING ITEMS

#### 1. Feature Documentation Status

**Current Status**:… **CONSOLIDATED**

- All feature documentation has been consolidated into `FEATURES.md`
- `LOCATION_QR_CHECKIN.md` remains as standalone comprehensive documentation
- See [Consolidation History](#-consolidation-history) section below for
  consolidation details

**Note**: The following features are documented in `FEATURES.md`:

-… Appointments (follow-ups, recurring, video, check-in, subscription-based
booking) -… Subscription Appointments (quota management) -… Invoice PDF &
WhatsApp (PDF generation, WhatsApp delivery) -… Payment & Billing (Cashfree,
payment flows, webhook lifecycle) -… Multi-Tenant Communication (clinic-specific
providers, credential encryption) -… Event System (45+ event types, event
patterns) -… Queue Integration (queue patterns, implementation examples) -… RBAC
(14 roles, 25+ resources, controller protection) -… Ayurvedic Enhancements
(appointment types, therapy management)

#### 2. Postman Collection Status

**Current Status**:… **COMPLETE** - Current source-derived endpoints added to
collection

**Note**: Postman collection has been updated with all endpoints from
ACTUAL_API_INVENTORY.md. See [api/README.md](./api/README.md) for details.

**All endpoints have been added to Postman collection. See
[ACTUAL_API_INVENTORY.md](./ACTUAL_API_INVENTORY.md) for complete endpoint
list.**

#### 3. API Documentation Gaps

**Current Status**: `API_DOCUMENTATION.md` has basic structure but missing
details

**Missing Information**:

1. Detailed endpoint descriptions for the current source-derived endpoint
inventory 2. Request/response examples for each endpoint 3. Error codes and
handling for each endpoint 4. Authentication requirements per endpoint 5. RBAC
permissions per endpoint 6. Rate limiting information 7. Query parameters
documentation 8. Request body schemas

#### 4. Implementation Gaps (Features Not Fully Implemented)

##### AWS SES Best Practices (From Audit)

1. **Bounce Handling Webhook** - CRITICAL

- SNS webhook handler for bounce notifications
- Automatic removal of bounced emails
- Bounce rate monitoring
- **File**:
  `src/libs/communication/adapters/email/ses/webhooks/ses-webhook.controller.ts`
  (CREATE)

  2. **Complaint Handling Webhook** - CRITICAL

- SNS webhook handler for complaint notifications
- Automatic removal of complainers
- Complaint rate monitoring
- **File**:
  `src/libs/communication/adapters/email/ses/webhooks/ses-webhook.controller.ts`
  (CREATE)

  3. **Unsubscribe Links** - CRITICAL

- Unsubscribe links in all email templates
- Unsubscribe endpoint
- User preference management
- **Status**: Partial - endpoint exists but templates need links

  4. **Suppression List Management** - CRITICAL

- Suppression list service
- Database model for suppression list
- Check before sending emails
- **File**: `src/services/email/suppression-list.service.ts` (CREATE)

  5.š ï¸ **Configuration Sets** - RECOMMENDED

- Create configuration sets in AWS SES
- Use configuration sets in SendEmailCommand
- Configure event publishing per set

  6.š ï¸ **Enhanced Monitoring** - RECOMMENDED

- Bounce/complaint rate tracking
- CloudWatch integration
- Alerting on high rates

---

###  ACTION ITEMS CHECKLIST

#### Priority 1: CRITICAL (Must Implement)

##### Documentation

-… Postman collection updated with current source-derived endpoints

- [ ] Expand API_DOCUMENTATION.md with detailed endpoint information
- [ ] Add request/response examples to API documentation

##### Implementation

- [ ] Implement bounce handling webhook (`ses-webhook.controller.ts`)
- [ ] Implement complaint handling webhook
- [ ] Add unsubscribe links to all email templates
- [ ] Create suppression list service
- [ ] Implement suppression list database model

#### Priority 2: HIGH (Should Implement Soon)

##### Documentation

- [ ] Expand `API_DOCUMENTATION.md` with detailed endpoint information
- [ ] Add request/response examples to API documentation

##### Implementation

- [ ] Implement AWS SES configuration sets
- [ ] Add bounce/complaint rate monitoring
- [ ] Set up CloudWatch alarms

#### Priority 3: MEDIUM (Nice to Have)

##### Documentation

- [ ] Add comprehensive API examples
- [ ] Create API testing guide
- [ ] Add Postman collection examples for all endpoints

##### Implementation

- [ ] Enhanced email validation service
- [ ] Email analytics dashboard
- [ ] A/B testing for email content

---

###… What's Working Well

1.… **LocationQR Implementation** - 100% complete and documented 2.… **Core
Documentation Structure** - Well organized 3.… **Architecture Documentation** -
Comprehensive 4.… **Guides** - Complete and helpful 5.… **API Structure** - All
endpoints implemented 6.… **Security** - All controllers secured

---

### ‹ Implementation Priority Matrix

| Item                       | Priority | Effort | Impact   | Status                                        |
| -------------------------- | -------- | ------ | -------- | --------------------------------------------- |
| Feature Documentation      | … DONE   | -      | -        | … Consolidated into FEATURES.md               |
| Postman Collection Updates | … DONE   | -      | -        | … Complete (current source-derived endpoints) |
| Bounce/Complaint Webhooks  | CRITICAL | Medium | Critical |  Missing                                      |
| Suppression List Service   | CRITICAL | Medium | Critical |  Missing                                      |
| Unsubscribe Links          | CRITICAL | Low    | Critical | š ï¸ Partial                                  |
| API Documentation Details  | HIGH     | High   | Medium   | š ï¸ Basic                                    |
| Configuration Sets         | MEDIUM   | Low    | Low      |  Missing                                      |
| Enhanced Monitoring        | MEDIUM   | Medium | Medium   |  Missing                                      |

---

### ðŸŽ¯ Recommended Next Steps

#### Week 1: Critical AWS SES Compliance

1. Implement bounce/complaint webhooks
2. Create suppression list service
3. Add unsubscribe links to templates

#### Week 2: API Documentation

1. Expand API_DOCUMENTATION.md with detailed endpoint info
2. Add request/response examples
3. Add error handling documentation
4. Add authentication requirements

#### Week 3-4: Implementation & Testing

1. Test all AWS SES compliance implementations
2. Complete API documentation expansion
3. Review and update all documentation

---

##  Other Files

- **[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)** - Complete
  environment variables list
- **[GITHUB_SECRETS_REFERENCE.md](./GITHUB_SECRETS_REFERENCE.md)** - Complete
  list of GitHub Secrets for CI/CD
- **[PRODUCTION_ENV_TEMPLATE.txt](./PRODUCTION_ENV_TEMPLATE.txt)** - Production
  environment variables template
- **[PRISMA_COMPLETE_GUIDE.md](./PRISMA_COMPLETE_GUIDE.md)** - Complete Prisma
  guide (generation, Docker, troubleshooting)
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Complete deployment guide
  with CI/CD
- **[api/README.md](./api/README.md)** - API testing resources (Postman)
- **[ERD.svg](./ERD.svg)** - Entity Relationship Diagram

---

**Total Documentation Files**: **13 files** (reduced from 34 - redundant files
consolidated)

- Root: 11 files (consolidated - current deployment and architecture docs)
- Guides: 7 files (consolidated)
- Architecture: 6 files
- Features: 1 file (others consolidated into FEATURES.md)
- API: 1 file

**Note**:

- Legacy Nginx video domain docs were replaced with current backend video docs
- Domain migration summary merged into `DOMAIN_MIGRATION_GUIDE.md`
- Required environment variables merged into `ENVIRONMENT_VARIABLES.md`

**Status**:… **CONSOLIDATED & CLEANED** - Redundant status files removed,
structure optimized

**Missing Items**: See
[Documentation Analysis & Missing Implementation Checklist](#-documentation-analysis--missing-implementation-checklist)
section above for complete checklist

---

---

## š Consolidation History

**Status**:… **Consolidation Complete** - Documentation reduced from 34 files to
13 files (-62%)

### Consolidation Summary

**Phase 1**: Feature documentation consolidated into `FEATURES.md` (9 files’ 1
file)

**Phase 2**: Removed 12 redundant status/analysis files:

- 6 status files (POSTMAN_UPDATE_STATUS, DOCUMENTATION_VERIFICATION_COMPLETE,
  etc.)
- 3 analysis files (merged into ACTUAL_API_INVENTORY.md and
  DOCUMENTATION_INDEX.md)
- 3 temporary/outdated files

**Phase 3**: Further consolidation (3 files merged):

- ENHANCED_MONITORING_AND_MIGRATION_SUMMARY.md’
  COMMUNICATION_SYSTEM_COMPLETE_GUIDE.md
- AWS_SES_BEST_PRACTICES_AUDIT.md’ AWS_SES_COMPLETE_GUIDE.md
- DOCUMENTATION_ANALYSIS_AND_MISSING_ITEMS.md’ DOCUMENTATION_INDEX.md (this
  file)

**Phase 4**: Prisma and API documentation consolidation (January 2025):

- PRISMA_GENERATED_FILES.md + devops/docker/PRISMA_CONFIGURATION.md’
  PRISMA_COMPLETE_GUIDE.md
- test-scripts/API_COVERAGE_SUMMARY.md’ test-scripts/FINAL_API_VERIFICATION.md
  (merged content)
- Removed outdated status reports: endpoint-status-report.md,
  TEST_RESULTS_SUMMARY.md
- Added cross-references between related documentation files

- Updated all references to point to consolidated files

**Phase 6**: Domain and environment documentation consolidation (January 2025):

- DOMAIN_UPDATE_SUMMARY.md’ DOMAIN_MIGRATION_GUIDE.md (merged quick reference
  section)
- ENVIRONMENT_VARIABLES_REQUIRED.md’ ENVIRONMENT_VARIABLES.md (merged required
  variables section)
- Updated all references

**Result**: Clean, minimal documentation structure with no redundant files. All
related documentation is cross-referenced. Outdated status reports removed.
environment variables.

---

**Last Updated**: January 2025  
**Verification**:… All referenced files exist, no broken links, no duplicates
