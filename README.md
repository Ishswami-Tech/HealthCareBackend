# Healthcare Backend API

A modern, scalable healthcare management system built with NestJS, PostgreSQL,
and Redis. **Production-ready for 1M+ concurrent users** with enterprise-grade
performance, HIPAA compliance, and advanced scaling optimizations.

## 🎯 Production Features for 1M+ Users

- **⚡ High Performance**: Sub-200ms response times under 1M concurrent users
- **📈 Auto-Scaling**: Kubernetes HPA (5-200 pods) with custom metrics
- **🔐 Enterprise Security**: RBAC, Network Policies, HIPAA-compliant logging
- **📊 Built-in Monitoring**: Custom logging dashboard at `/logger` (no ELK
  overhead)
- **🚀 High Availability**: PodDisruptionBudget, Redis Cluster (3-9 nodes),
  optimized PostgreSQL
- **💰 Resource Efficient**: 40% savings by leveraging custom logging instead of
  heavy ELK stack

## 🚀 Quick Start

### Prerequisites

- Node.js (v16+)
- PostgreSQL (v14+)
- Redis (v6+)
- Docker & Docker Compose

### Development Setup

```bash
# Clone and setup
git clone [repository-url]
cd healthcare-backend
yarn install

# Environment setup
cp .env.example .env
# Configure your environment variables

# Prisma Client is automatically generated on install
# If you modify the schema, it will auto-regenerate on commit (via pre-commit hook)

# Start development environment
./run.sh dev start
```

### Prisma Schema Management

This project uses **committed generated files** with automated validation:

- **Pre-commit hook**: Automatically regenerates Prisma Client when schema
  changes
- **Post-merge hook**: Regenerates after merging branches
- **CI validation**: Ensures generated files are always up-to-date
- **Build integration**: Validates and regenerates during build

**Key Commands**:

```bash
# Generate Prisma Client
yarn prisma:generate

# Regenerate and validate
yarn prisma:regenerate

# Validate generated files
yarn prisma:validate-generated
```

For detailed information, see:

- [Prisma Complete Guide](./docs/PRISMA_COMPLETE_GUIDE.md) - Complete Prisma
  guide (generation, Docker, troubleshooting)
- [Docker README](./devops/docker/README.md#-prisma-schema-management) - Prisma
  setup and Docker compatibility

### Production Deployment (Kubernetes - 1M Users)

**Quick Deploy:**

```bash
# Create secrets (update with actual values)
kubectl create secret generic healthcare-secrets \
  --from-literal=database-url='postgresql://user:pass@postgres:5432/userdb' \
  --from-literal=jwt-secret='your-secure-jwt-secret-32-chars-min' \
  --namespace=healthcare-backend

# Deploy to production
kubectl apply -k devops/kubernetes/overlays/production/

# Verify deployment
kubectl get all,hpa,vpa,pdb -n healthcare-backend
```

**See:** [QUICK_START_1M_USERS.md](QUICK_START_1M_USERS.md) for detailed
deployment guide.

### Local Development

```bash
# Using Docker Compose (fastest, deprecated for production)
make start              # Start all services
make dev                # Start dev server with hot-reload

# Using Local Kubernetes (test autoscaling)
make k8s-local-build    # Build image
make k8s-local-deploy   # Deploy to local K8s
make k8s-local-access   # Access at localhost:8088
```

### Access Points

- **API**: http://localhost:8088
- **Health Check**: http://localhost:8088/health
- **Swagger Docs**: http://localhost:8088/api
- **Custom Logging Dashboard**: http://localhost:8088/logger (HIPAA-compliant)
- **Queue Dashboard**: http://localhost:8088/queue-dashboard
- **Metrics**: http://localhost:8088/metrics (Prometheus format)
- **Prisma Studio**: http://localhost:5555

## Dockerless CI/CD (containerd)

- Use `.github/workflows/deploy-k8s.yml` to build with Buildah/Podman (no Docker
  daemon), push to GHCR, and deploy via `kubectl` with Kustomize overlays.
- Prefer Kubernetes + containerd for all production deployments. Docker Compose
  is for local use only.

## 🏥 Key Features

### Core Features

- **Multi-Clinic Support**: Up to 200 clinics with complete data isolation
- **Enterprise Performance**: 1M+ concurrent users with auto-scaling
- **HIPAA Compliant**: Full healthcare data protection and audit trails
- **Advanced Authentication**: JWT with OTP, session management, and RBAC
- **Real-time Features**: WebSocket support, live notifications, and queue
  management
- **Plugin Architecture**: Extensible appointment system with domain-specific
  plugins

### 🌿 Ayurvedic Healthcare Specialization

- **13 Specialized Appointment Types**: Panchakarma, Agnikarma, Shirodhara, Nadi
  Pariksha, etc.
- **Prakriti & Dosha Analysis**: Comprehensive constitutional assessment and
  tracking
- **Therapy Management**: Multi-session therapy programs with automated
  scheduling
- **Specialized Queues**: Separate queues for different therapy types (SHODHANA,
  SHAMANA, etc.)
- **Location-Based Check-In**: QR code and geofencing-based patient verification
- **Enhanced Ayurvedic Profiles**: Agni assessment, Vikriti tracking, seasonal
  patterns
- **7 New Healthcare Roles**: Therapist, Pharmacist, Nurse, Lab Technician, etc.

## 🛠️ Tech Stack

- **Framework**: NestJS (v9.x)
- **Database**: PostgreSQL (v14+) with Prisma ORM - Optimized for 500 concurrent
  connections
- **Caching**: Redis Cluster (3-9 nodes) with auto-scaling
- **Queue System**: BullMQ with 19 specialized queues
- **Runtime**: Node.js (v20+)
- **Language**: TypeScript
- **Orchestration**: Kubernetes with HPA/VPA
- **Package Manager**: Yarn (1.22.22) - Fast and reliable package management

## 📚 Documentation

### 🚀 Production Deployment (1M Users)

- **[Quick Start - 1M Users](QUICK_START_1M_USERS.md)** - 5-minute production
  deployment
- **[Production Optimization](PRODUCTION_OPTIMIZATION_1M_USERS.md)** - Complete
  optimization guide
- **[Deployment Strategy](DEPLOYMENT_STRATEGY.md)** - Docker vs Kubernetes
  decision guide
- **[DevOps Guide](devops/README.md)** - Kubernetes + Docker documentation
- **[Local Kubernetes](devops/kubernetes/LOCAL_KUBERNETES.md)** - Run K8s on
  your laptop
- **[Enterprise Checklist](devops/ENTERPRISE_CHECKLIST.md)** - Production
  readiness (98/100)

### Development & Architecture

- **[API Documentation](docs/api/README.md)** - Complete API reference
- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** - Complete technical
  documentation

### System Design

- [System Architecture](docs/architecture/SYSTEM_ARCHITECTURE.md) - Complete
  architecture + data flows
- [Complete System Summary](docs/architecture/COMPLETE_SYSTEM_SUMMARY.md) -
  Feature summary + API reference
- [Integration Verification](docs/architecture/INTEGRATION_VERIFICATION.md) -
  Integration status report

### Features

- [Subscription Appointments](docs/features/SUBSCRIPTION_APPOINTMENTS.md) -
  Subscription-based appointments system
- [Invoice PDF & WhatsApp](docs/features/INVOICE_PDF_WHATSAPP_FEATURE.md) -
  Invoice generation & delivery
- [Notification System](docs/features/NOTIFICATION_SYSTEM_IMPLEMENTATION.md) -
  Multi-channel notifications
- [Location QR Check-In](docs/features/LOCATION_QR_CHECKIN.md) - Static
  location-based QR code check-in system

### Implementation Guides

- [Notification Setup Guide](docs/guides/NOTIFICATION_IMPLEMENTATION_GUIDE.md) -
  Step-by-step setup
- [Notification Strategy](docs/guides/NOTIFICATION_STRATEGY.md) - Architecture &
  cost planning
- [AI Implementation Prompts](docs/guides/AI_IMPLEMENTATION_PROMPT.md) -
  AI-assisted development
- [Testing Appointment Endpoints](docs/guides/TESTING_APPOINTMENT_ENDPOINTS.md) -
  Role-based testing guide
- [AWS SES Best Practices Audit](docs/guides/AWS_SES_BEST_PRACTICES_AUDIT.md) -
  SES compliance audit

### Service Documentation

- [Error Handling System](src/libs/core/errors/README.md) - Healthcare error
  system
- [Multi-Tenant Clinic System](src/services/clinic/README.md) - Clinic isolation
  architecture
- [User Service](src/services/users/README.md) - User management &
  authentication

### Infrastructure & Integration

- [HTTP Service](src/libs/infrastructure/http/README.md) - Centralized HTTP
  service with retry logic and error handling
- [Redis Caching System](src/libs/infrastructure/cache/CACHE_DOCUMENTATION.md) -
  Enterprise caching with SWR
- [WhatsApp Integration](src/libs/communication/messaging/whatsapp/WHATSAPP_INTEGRATION.md) -
  WhatsApp Business API setup

### DevOps & Deployment

- [Production Deployment](devops/README.md) - Deployment overview
- [Production Optimization](devops/docs/PRODUCTION_OPTIMIZATION_GUIDE.md) -
  Performance tuning for 1M+ users
- [SSL Certificates](devops/nginx/SSL_CERTIFICATES.md) - SSL/TLS configuration
- [Cloudflare Setup](devops/nginx/CLOUDFLARE_SETUP.md) - CDN configuration

## 🔧 Available Scripts

```bash
# Development
yarn start:dev          # Start with hot-reloading
yarn build              # Build for production

# Database
yarn prisma:generate    # Generate Prisma client
yarn prisma:migrate     # Run migrations
yarn prisma:seed        # Seed database

# Testing
yarn test               # Run unit tests
yarn test:e2e           # Run e2e tests

# Docker
./run.sh dev start         # Start development environment
./run.sh dev stop          # Stop development environment
```

## 🌐 Main API Endpoints

### Authentication (`/auth`)

- `POST /auth/register` - User registration
- `POST /auth/login` - User login (password/OTP)
- `POST /auth/refresh` - Refresh JWT token
- `POST /auth/logout` - User logout
- `POST /auth/request-otp` - Request OTP (email/SMS/WhatsApp)
- `POST /auth/verify-otp` - Verify OTP

### Users (`/users`)

- `GET /users` - Get all users (admin)
- `GET /users/profile` - Get current user profile
- `PUT /users/profile` - Update user profile
- `GET /users/patients` - Get all patients
- `GET /users/doctors` - Get all doctors

### Appointments (`/appointments`)

- `GET /appointments` - List appointments
- `POST /appointments` - Create appointment
- `GET /appointments/:id` - Get appointment details
- `PUT /appointments/:id` - Update appointment
- `DELETE /appointments/:id` - Cancel appointment
- `GET /appointments/doctor/:doctorId/availability` - Check doctor availability

### Clinics (`/clinics`)

- `GET /clinics` - List clinics
- `POST /clinics` - Create clinic (admin)
- `GET /clinics/:id` - Get clinic details
- `PUT /clinics/:id` - Update clinic
- `GET /clinics/:id/doctors` - Get clinic doctors
- `GET /clinics/:id/patients` - Get clinic patients

### Health Monitoring (`/health`)

- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system health
- `GET /health/api` - API-specific health

## 🔐 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Multi-Factor Authentication**: OTP via email, SMS, WhatsApp
- **Role-Based Access Control**: 15+ healthcare-specific roles
- **HIPAA Compliance**: Audit trails and PHI data protection
- **Rate Limiting**: Protection against brute force attacks
- **Session Management**: Multi-device session tracking

## 📈 Performance

- **Response Time**: < 100ms average
- **Concurrent Users**: 10+ lakh users supported
- **Database**: 300 connections, intelligent query batching
- **Caching**: Redis with 1GB memory, LRU eviction
- **Queue System**: 19 specialized queues for different operations

## 🏗️ Architecture

### System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Gateway   │    │   Load Balancer │
│   (Next.js)     │◄──►│   (NestJS)      │◄──►│   (Nginx)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Application   │
                       │   Layer         │
                       └─────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │ PostgreSQL  │ │    Redis    │ │   BullMQ    │
        │ (Primary)   │ │   (Cache)   │ │  (Queues)   │
        └─────────────┘ └─────────────┘ └─────────────┘
```

### Core Services

- **Authentication Service**: Plugin-based auth with domain support
  (Healthcare/Fashion)
- **User Management**: Role-based access with 15+ healthcare-specific roles
- **Appointment System**: Plugin architecture with conflict resolution and
  workflow engine
- **Clinic Management**: Multi-tenant with complete data isolation and
  enterprise dashboard
- **Health Monitoring**: Real-time system health and performance metrics

### Infrastructure Components

#### **Database Layer**

- **PostgreSQL**: 300 connections with intelligent query batching
- **Connection Pooling**: 20-300 connections with circuit breaker patterns
- **Prisma ORM**: Request-scoped for multi-tenancy
- **Health Monitoring**: Real-time database metrics and auto-scaling

#### **Caching Strategy**

- **Multi-Level Caching**: Memory + Redis with clinic-specific keys
- **TTL Configuration**:
  - Clinic data: 1 hour
  - Patient data: 30 minutes
  - Appointments: 5 minutes
  - Emergency data: 1 minute

#### **Queue System (19 Specialized Queues)**

- **Appointment Queues**: clinic-appointment, enhanced-appointment,
  doctor-availability
- **Communication Queues**: email, notification, reminder, follow-up
- **Healthcare Queues**: vidhakarma, panchakarma, ayurveda-therapy
- **Management Queues**: queue-management, waiting-list, payment-processing
- **Analytics Queues**: analytics, calendar-sync, patient-preference

#### **Security & Compliance**

- **JWT Authentication**: Multi-device session management
- **RBAC System**: Resource-level permissions with clinic isolation
- **HIPAA Compliance**: Audit trails and PHI data protection
- **Rate Limiting**: Progressive lockout with circuit breaker patterns

#### **Real-time Communication**

- **WebSocket**: Room-based messaging with reconnection handling
- **Event-Driven Architecture**: Enterprise event service with HIPAA compliance
- **Multi-channel OTP**: Email, SMS, WhatsApp with intelligent fallback

#### **HTTP Service (Centralized)**

- **Centralized HTTP Client**: Unified HTTP service with automatic error
  handling
- **Retry Logic**: Configurable retries with exponential backoff
- **Automatic Logging**: Request/response logging via LoggingService
- **Type-Safe**: Full TypeScript support with generic types
- **Error Transformation**: All errors converted to HealthcareError

## 🚀 Deployment

```bash
# Docker deployment
docker build -t healthcare-api .
docker run -p 8088:8088 healthcare-api

# Production
./run.sh prod start
```

## 🚨 Troubleshooting

### Common Issues

- **Database Connection**: Check PostgreSQL is running and accessible
- **Redis Connection**: Verify Redis server is running on port 6379
- **Port Conflicts**: Ensure ports 8088, 5555, 8082 are available
- **Environment Variables**: Verify all required env vars are set

### Quick Fixes

```bash
# Reset database
yarn prisma:migrate:reset

# Clear cache
redis-cli FLUSHALL

# Restart services
./run.sh dev restart
```

## 📞 Support

- **API Documentation**: http://localhost:8088/api (when running)
- **Queue Dashboard**: http://localhost:8088/queue-dashboard
- **Issues**: GitHub Issues
- **Technical Support**: Contact the development team

## 👥 Author

- [Aadesh Bhujbal](https://github.com/aadeshbhujbal) - Lead Developer & System
  Architect

---

**For detailed technical information, see
[Developer Guide](docs/DEVELOPER_GUIDE.md)**
