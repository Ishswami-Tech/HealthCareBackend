# Healthcare Backend API

A modern, scalable backend system for healthcare management built with NestJS, PostgreSQL, and Redis. This system is designed to handle the complete workflow of healthcare clinics, from patient management to appointment scheduling and medical record keeping, with a special focus on Ayurvedic practices.

## 📁 Project Structure

```
src/
├── config/               # Configuration modules and environment setup
├── libs/                 # Shared libraries, DTOs, and utilities
│   ├── dtos/            # Data Transfer Objects
│   └── filters/         # Global filters (e.g., HTTP exceptions)
├── services/            # Feature modules and business logic
│   └── users/           # User management module
│       ├── controllers/ # User-related controllers
│       └── services/    # User-related services
├── shared/             # Shared modules and utilities
│   ├── cache/          # Redis caching implementation
│   └── database/       # Database configurations and Prisma setup
├── app.controller.ts   # Main application controller
├── app.module.ts       # Main application module
└── main.ts            # Application entry point
```

## 🏥 Features

- **User Management**
  - Multiple user roles (Super Admin, Clinic Admin, Doctor, Patient, Receptionist)
  - Authentication and Authorization with JWT
  - Profile management with avatar support
  - Role-based access control (RBAC)
  - User activity logging
  - Password reset and email verification

- **Clinic Management**
  - Multiple clinic support with independent configurations
  - Doctor-clinic associations with scheduling
  - Working hours management with break time support
  - Staff management and role assignment
  - Resource allocation and management
  - Multiple branch support

- **Appointment System**
  - Smart appointment scheduling with conflict prevention
  - Automated queue management
  - Multiple appointment types:
    - In-person consultations
    - Video call appointments
    - Home visits
  - Real-time status tracking
  - Appointment reminders via SMS/Email
  - Cancellation and rescheduling support
  - Waiting list management

- **Medical Records**
  - Comprehensive patient health records
  - Digital prescriptions with medicine tracking
  - Medicine inventory management
  - Lab reports and diagnostics integration
  - Document upload support (X-rays, MRI scans, etc.)
  - Medical history tracking
  - Allergy and medication alerts
  - Treatment progress tracking

- **Payment System**
  - Multiple payment methods integration
    - Cash payments
    - Card payments
    - UPI transactions
    - Net banking
  - Payment status tracking
  - Transaction history and reporting
  - Invoice generation
  - Refund processing
  - Subscription management for packages
  - GST compliance

- **Ayurvedic Features**
  - Prakriti and Dosha assessment tools
  - Pulse diagnosis recording
  - Classical and proprietary medicine tracking
  - Diet and lifestyle recommendations
  - Seasonal health guidance
  - Panchakarma treatment tracking
  - Herbal medicine inventory

- **Advanced Features**
  - Real-time notifications
  - SMS and Email integration
  - WhatsApp Business API integration
  - Report generation
  - Analytics dashboard
  - Audit logging
  - Data export/import
  - Backup and recovery
  - Multi-language support

## Authentication Features

### OTP Authentication
- Multi-channel OTP delivery (WhatsApp, SMS, Email)
- **NEW: Automatic delivery through all available channels**
- Intelligent fallback between delivery methods
- Retry logic with exponential backoff
- Comprehensive error handling and logging

### Security Features
- JWT-based authentication
- **NEW: Token invalidation on logout**
- **NEW: Session management (logout from specific sessions or all devices)**
- Rate limiting to prevent brute force attacks
- IP-based security measures

## 🏗️ Architecture

### Backend Architecture
- **API Layer**: NestJS controllers and DTOs
- **Service Layer**: Business logic implementation
- **Data Layer**: Prisma ORM with PostgreSQL
- **Cache Layer**: Redis for performance optimization
- **Authentication**: JWT with refresh token rotation
- **File Storage**: S3-compatible storage for documents

### Database Design
- Normalized database schema
- Efficient indexing for performance
- Soft delete implementation
- Audit trail tables
- Relationship management
- Data versioning

### Caching Strategy
- Redis for high-performance caching
- Cache invalidation patterns
- Distributed caching support
- Cache warming mechanisms
- TTL-based cache management

## 🚀 Tech Stack

- **Framework**: NestJS (v9.x)
- **Database**: 
  - PostgreSQL (v14+)
  - Prisma ORM (v4.x)
- **Caching**: Redis (v6.x)
- **API Documentation**: Swagger/OpenAPI 3.0
- **Runtime**: Node.js (v16+)
- **Language**: TypeScript (v4.x)
- **Testing**: Jest & Supertest
- **CI/CD**: GitHub Actions
- **Containerization**: Docker & Docker Compose
- **Monitoring**: Prometheus & Grafana

## 🛠️ Development Setup

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v14 or higher)
- Redis (v6 or higher)
- Docker & Docker Compose
- Git

### Environment Configuration

Three environment configurations are available:

1. Development (`.env.development`):
```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
PRISMA_SCHEMA_PATH=./src/shared/database/prisma/schema.prisma
```

2. Production (`.env.production`):
```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/userdb?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
PRISMA_SCHEMA_PATH=./src/shared/database/prisma/schema.prisma
```

### Docker Development Setup

The application includes a development-specific Docker setup with hot-reloading for a better development experience:

1. **Development Docker Compose**:
   - Uses `docker-compose.dev.yml` for development
   - Hot-reloading enabled for code changes
   - Volume mounts for local code
   - Separate development containers

2. **Development Dockerfile**:
   - Uses `Dockerfile.dev` for development
   - Includes all development dependencies
   - Configures proper permissions for hot-reloading

3. **Run Script**:
   - Provides a convenient `run.sh` script for managing the application
   - Supports both development and production modes
   - Includes commands for logs, backups, and maintenance

#### Development Commands

```bash
# Start development environment with hot-reloading
./run.sh dev start

# View logs
./run.sh dev logs:api    # API logs
./run.sh dev logs:db     # Database logs
./run.sh dev logs:redis  # Redis logs

# Restart services
./run.sh dev restart

# Stop services
./run.sh dev stop

# Clean up (with volumes)
./run.sh dev clean --volumes
```

#### Development Features

- **Hot Reloading**: Changes to your code are automatically detected and the application restarts
- **Volume Mounts**: 
  - Your local code is mounted to `/app` in the container
  - `node_modules` is excluded from the mount to prevent conflicts
- **Development Tools**:
  - Prisma Studio: http://localhost:5555
  - PgAdmin: http://localhost:5050 (admin@admin.com/admin)
  - Redis Commander: http://localhost:8082 (admin/admin)

### Docker Services

The application uses Docker Compose with the following services:

1. **API Service**:
   - NestJS application
   - Ports: 8088 (API), 5555 (Prisma Studio)
   - Development hot-reload enabled

2. **PostgreSQL**:
   - Latest PostgreSQL
   - Port: 5432
   - Health check enabled
   - Persistent volume storage

3. **PgAdmin**:
   - Database management interface
   - Port: 5050
   - Default credentials:
     - Email: admin@admin.com
     - Password: admin

4. **Redis**:
   - Latest Redis
   - Port: 6379
   - Health check enabled

5. **Redis Commander**:
   - Redis management interface
   - Port: 8082
   - Default credentials:
     - Username: admin
     - Password: admin

### Installation Steps

1. Clone and setup:
```bash
git clone [repository-url]
cd healthcare-backend
npm install
```

2. Environment setup:
```bash
cp .env.example .env
# Configure environment variables
```

3. Start Docker services:
```bash
# For development with hot-reloading
./run.sh dev start

# For production
./run.sh prod start
```

4. Database setup:
```bash
npm run prisma:generate    # Generate Prisma client
npm run prisma:migrate    # Run migrations
npm run prisma:seed      # Seed database
```

### Available Scripts

```json
{
  "scripts": {
    "build": "nest build",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate --schema=./src/shared/database/prisma/schema.prisma",
    "prisma:migrate": "prisma migrate deploy --schema=./src/shared/database/prisma/schema.prisma",
    "prisma:seed": "ts-node src/shared/database/prisma/seed.ts",
    "prisma:studio": "prisma studio --schema=./src/shared/database/prisma/schema.prisma",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:cov": "jest --coverage"
  }
}
```

### Development Tools

1. **TypeScript Configuration**:
   - Target: ES2021
   - Module: CommonJS
   - Decorators enabled
   - Strict null checks disabled
   - Source maps enabled

2. **ESLint Configuration**:
   - TypeScript ESLint
   - Prettier integration
   - Custom rules:
     - no-explicit-any: off
     - no-floating-promises: warn
     - no-unsafe-argument: warn

3. **Git Configuration**:
   - Line endings normalized (LF)
   - Appropriate gitignore rules
   - Husky for git hooks

4. **VS Code Settings**:
   - Debug configurations
   - Extension recommendations
   - Editor settings

## 🔐 Security Implementations

1. **Authentication**:
   - JWT-based authentication
   - Refresh token mechanism
   - Role-based access control

2. **Data Protection**:
   - Request validation
   - SQL injection prevention
   - XSS protection
   - CSRF tokens

3. **API Security**:
   - Rate limiting
   - CORS protection
   - Helmet security headers

## 📊 Monitoring & Maintenance

1. **Health Checks**:
   - Database connectivity
   - Redis connection
   - Application health status

2. **Performance Monitoring**:
   - Redis cache statistics
   - Database query metrics
   - API response times
   - Resource utilization

3. **Logging**:
   - Application logs
   - Error tracking
   - Audit trails
   - Performance metrics

## 🚀 Deployment

### Docker Deployment

1. Build the image:
```bash
docker build -t healthcare-api .
```

2. Run the container:
```bash
docker run -p 8088:8088 healthcare-api
```

### Production Considerations

1. **Environment**:
   - Use production environment variables
   - Enable production optimizations
   - Configure appropriate scaling

2. **Security**:
   - Secure all endpoints
   - Enable rate limiting
   - Configure SSL/TLS

3. **Monitoring**:
   - Set up health checks
   - Configure logging
   - Enable performance monitoring

## 📋 Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v14 or higher)
- Redis (v6 or higher)
- Docker & Docker Compose (optional)
- Git

## 🛠️ Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd healthcare-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration:
# - Database connection
# - Redis connection
# - JWT secrets
# - SMTP settings
# - S3 credentials
```

4. Generate Prisma client:
```bash
npx prisma generate
```

5. Run database migrations:
```bash
npx prisma migrate dev
```

6. Seed the database:
```bash
npx prisma db seed
```

### Docker Setup
```bash
# For development with hot-reloading
./run.sh dev start

# For production
./run.sh prod start

# View logs
./run.sh dev logs:api

# Stop services
./run.sh dev stop
```

## 🚀 Running the Application

### Development
```bash
# Start in development mode with hot-reloading
./run.sh dev start

# View logs
./run.sh dev logs:api
```

### Production
```bash
# Start in production mode
./run.sh prod start

# With PM2
pm2 start dist/main.js --name healthcare-api
```

## 📚 API Documentation

Once the application is running, access the Swagger documentation at:
```http://localhost:8088/api

## 🌐 API Endpoints

### Authentication
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `POST /auth/refresh` - Refresh token
- `POST /auth/forgot-password` - Password reset request
- `POST /auth/reset-password` - Reset password

### Users
- `GET /users` - Get all users
- `GET /users/:id` - Get user by ID
- `POST /users` - Create new user
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user
- `GET /users/me` - Get current user profile

### Appointments
- `GET /appointments` - List appointments
- `POST /appointments` - Create appointment
- `PUT /appointments/:id` - Update appointment
- `DELETE /appointments/:id` - Cancel appointment
- `GET /appointments/calendar` - Get calendar view
- `POST /appointments/:id/confirm` - Confirm appointment

### Clinics
- `GET /clinics` - List clinics
- `POST /clinics` - Add new clinic
- `PUT /clinics/:id` - Update clinic details
- `GET /clinics/:id/doctors` - List clinic doctors
- `GET /clinics/:id/schedule` - Get clinic schedule

### Health Records
- `GET /health-records/:patientId` - Get patient records
- `POST /health-records` - Add new health record
- `GET /health-records/:id/history` - Get record history
- `POST /health-records/:id/documents` - Upload documents

### Prescriptions
- `GET /prescriptions/:patientId` - Get patient prescriptions
- `POST /prescriptions` - Create new prescription
- `GET /prescriptions/:id/pdf` - Download PDF
- `PUT /prescriptions/:id` - Update prescription

### Medicines
- `GET /medicines` - List medicines
- `POST /medicines` - Add medicine
- `PUT /medicines/:id` - Update medicine
- `GET /medicines/inventory` - Check inventory

## 🔍 Monitoring & Maintenance

### Health Checks
- `/health` - Basic health check
- `/health/live` - Liveness probe
- `/health/ready` - Readiness probe

### Monitoring Endpoints
- `/metrics` - Prometheus metrics
- `/users/monitoring/cache-status` - Redis cache status
- `/users/monitoring/redis-status` - Redis performance metrics
- `/cache/stats` - Cache statistics

### Maintenance
- Database backup script
- Log rotation configuration
- Cron job setup
- Monitoring dashboard

## 🧪 Testing

Run tests:
```bash
# Unit tests
npm run test

# e2e tests
npm run test:e2e

# Test coverage
npm run test:cov

# Test specific file
npm test -- users.service.spec.ts
```

## 🔒 Security

- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Request validation and sanitization
- Rate limiting and brute force protection
- Secure password hashing with bcrypt
- CORS protection
- Helmet security headers
- SQL injection prevention
- XSS protection
- CSRF tokens
- API key authentication for external services
- Request logging and audit trails

## 🔧 Development Tools

- ESLint configuration
- Prettier setup
- Git hooks with Husky
- Conventional commits
- Debug configurations
- VS Code settings
- Development utilities

## 📈 Performance Optimization

- Redis caching
- Database indexing
- Query optimization
- Connection pooling
- Load balancing ready
- Response compression
- Static file caching
- Rate limiting

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Create a new Pull Request

### Coding Standards
- Follow TypeScript best practices
- Use NestJS architectural patterns
- Write unit tests for new features
- Update documentation
- Follow conventional commits

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Authors

- [Aadesh Bhujbal](https://github.com/aadeshbhujbal)
  - Lead Developer & System Architect
  - Backend Architecture Design
  - Database Schema Design
  - API Development
  - System Integration
  - DevOps Setup

## 🙏 Acknowledgments

- NestJS team for the amazing framework
- All contributors who participate in this project
- Open source community for various tools and libraries

## 📞 Support

- Technical Support: [your-email]
- Documentation: http://localhost:8088/api
- Issue Tracking: GitHub Issues

## 🗺️ Roadmap

1. **Q1 2024**
   - [ ] Telemedicine integration
   - [ ] AI-powered health predictions

2. **Q2 2024**
   - [ ] Mobile app development
   - [ ] Internationalization

3. **Q3 2024**
   - [ ] Advanced analytics dashboard
   - [ ] Integration with wearable devices

4. **Q4 2024**
   - [ ] ML-based diagnosis assistance
   - [ ] Blockchain for medical records

## 📈 Performance Metrics

- Response Time: < 100ms
- Cache Hit Ratio: > 80%
- API Availability: 99.9%
- Database Query Time: < 50ms

## 📱 WhatsApp Integration

The application includes integration with WhatsApp Business API for enhanced communication with patients:

- **OTP Delivery**: Send one-time passwords via WhatsApp
- **Appointment Reminders**: Send interactive appointment reminders with confirmation options
- **Prescription Notifications**: Deliver prescription details and documents directly to patients
- **Rich Media Support**: Send documents, images, and interactive messages

For detailed setup instructions, see [WHATSAPP_INTEGRATION.md](WHATSAPP_INTEGRATION.md).

## Multi-Tenant Architecture

This application uses a multi-tenant architecture with database-per-tenant isolation:

- **Super Admin** can create **Clinic Admins**
- **Clinic Admins** can create **Clinics**
- Each **Clinic** has:
  - Its own isolated database
  - Multiple locations/branches
  - Dedicated application instance

### Key Components

- **Central Database**: Stores system-wide data and tenant metadata
- **Tenant Databases**: Each clinic gets its own PostgreSQL database
- **Dynamic Routing**: Requests are routed to the appropriate database based on clinic subdomain

### Managing Tenant Schemas

When modifying database schemas:

1. Update the schema files:
   - Main schema: `src/shared/database/prisma/schema.prisma`
   - Tenant schema: `src/shared/database/prisma/tenant.schema.prisma`

2. Generate Prisma clients:
   ```
   npm run prisma:generate
   ```

3. Apply schema changes to all tenant databases:
   ```
   npm run tenant:update-schema
   ```

For more details, see [Multi-Tenant Architecture Documentation](src/services/clinic/README.md).
