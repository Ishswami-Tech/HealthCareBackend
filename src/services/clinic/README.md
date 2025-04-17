# Multi-Tenant Clinic Management System

This system implements a secure, isolated multi-tenant architecture for managing healthcare clinics. Each clinic operates as a separate tenant with its own dedicated database, complete data isolation, and application instance.

## Architecture Overview

### 1. Role-Based Hierarchy

- **Super Admin**: Manages the entire system, can create and manage Clinic Admins
- **Clinic Admin**: Can create and manage one or more Clinics
- **Clinic**: Has multiple locations/branches and its own isolated database

### 2. Database Architecture

#### Central Database (Global)
- Stores system-wide data:
  - Super Admin accounts
  - Clinic Admin accounts
  - Clinic metadata (name, subdomain, connection details)
  - Cross-tenant configurations

#### Tenant Databases (Per Clinic)
- Each clinic gets its own isolated PostgreSQL database
- Database names follow the pattern: `clinic_[subdomain]_db`
- Contains clinic-specific data:
  - Patients
  - Doctors
  - Appointments
  - Locations/Branches
  - Payments
  - Health records
  - Prescriptions
  - And more

### 3. Technical Implementation

#### Database Creation
When a new clinic is created:
1. A new PostgreSQL database is provisioned
2. Prisma schema is applied to create all necessary tables
3. Connection credentials are stored in the central database

#### Database Schema Updates
When the tenant schema changes:
1. Run `npm run prisma:generate` to update both main and tenant client code
2. Run `npm run tenant:update-schema` to apply schema changes to all tenant databases

#### Tenant Data Access
The system uses dynamic database connections:
1. Client makes a request with clinic identifier (subdomain)
2. System looks up connection details from central database
3. Request is routed to the appropriate tenant database

## Key Features

- **Complete Data Isolation**: Each clinic's data is stored in a separate database
- **Automatic Schema Management**: Prisma handles schema creation and updates
- **Database Administration**: Built-in tools for backup, restore, and maintenance
- **Security**: Proper access controls at all levels

## Development Workflow

1. **Modify Schemas**:
   - Main schema: `src/shared/database/prisma/schema.prisma`
   - Tenant schema: `src/shared/database/prisma/tenant.schema.prisma`

2. **Generate Clients**:
   - Run `npm run prisma:generate` to generate both client libraries

3. **Apply Schema Updates**:
   - Run `npm run tenant:update-schema` to update all tenant databases

4. **Test**:
   - Verify schema changes across tenants

## Additional Resources

- See `ClinicDatabaseService` for database management operations
- Check `tenant.schema.prisma` for tenant-specific model definitions
- Refer to `generate-all-schemas.ts` for schema generation process 