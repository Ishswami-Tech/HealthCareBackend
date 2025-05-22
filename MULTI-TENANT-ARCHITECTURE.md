# Multi-Tenant Architecture - Healthcare App

This document outlines the multi-tenant architecture implemented in the Healthcare App backend to support multiple clinics with data isolation.

## Overview

The application uses row-level multi-tenancy where all clinics share a single database with data isolated by `clinicId`. This approach provides a good balance between simplicity, performance, and security.

### Key Benefits of Row-Level Isolation

- **Simplified Schema Management**: Single schema for all tenants
- **Easy Maintenance**: Centralized migrations and schema updates
- **Excellent Performance**: With proper indexing on clinicId fields
- **Scalability**: Easily scales to hundreds or thousands of clinics
- **Simplified Queries**: No need to dynamically switch between databases
- **Simplified Infrastructure**: One database to manage, back up, and monitor

## Key Components

### 1. Tenant Context Extraction

- **ClinicContextMiddleware**: Extracts tenant information from:
  - Subdomain (e.g., `clinicA.healthcareapp.com`)
  - Headers (`x-clinic-id`, `x-clinic-identifier`)
  - Request parameters or query strings
  - Validates the clinic exists and is active

### 2. Row-Level Tenant Isolation

- **PrismaService**: Implements tenant isolation through Prisma middleware
  - Automatically adds `clinicId` filter to all database queries
  - Ensures data is isolated between tenants
  - Provides methods to manage the tenant context

### 3. Tenant Authorization

- **ClinicGuard**: Ensures users only access their authorized tenants
  - Validates user belongs to the requested clinic
  - Checks multiple relationships (admin, doctor, receptionist)
  - Prevents cross-tenant data access

### 4. Request Context Management

- **TenantContextInterceptor**: Maintains and cleans up the tenant context
  - Sets the tenant ID at the beginning of each request
  - Clears the tenant ID after the request completes

## Flow Diagram

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Request   │────▶│ClinicContextMiddleware│────▶│Extract tenant ID│
└─────────────┘     └──────────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────┐     ┌────────────────────┐       ┌───────────────┐
│   Response  │◀────│   Controller/      │◀──────│  ClinicGuard  │
└─────────────┘     │Service Operations  │       └───────┬───────┘
                    └────────────────────┘               │
                              ▲                          │
                              │                          ▼
                    ┌────────────────────┐       ┌───────────────┐
                    │   Prisma Middleware│◀──────│TenantContext  │
                    │adds clinicId filter│       │ Interceptor   │
                    └────────────────────┘       └───────────────┘
```

## Implementation Details

### Prisma Middleware for Tenant Isolation

The system uses Prisma middleware to automatically add `clinicId` filters to all database operations:

```typescript
this.$use(async (params, next) => {
  // Only apply to models with tenant ID
  if (!this.currentTenantId || !modelsWithTenantId.includes(params.model)) {
    return next(params);
  }

  // Add clinicId filter for read operations
  if (params.action === 'findUnique' || params.action === 'findFirst') {
    params.args.where = {
      ...params.args.where,
      clinicId: this.currentTenantId
    };
  }
  
  // Similar logic for other operations...
  
  return next(params);
});
```

### Schema Design

All tenant-specific models include a `clinicId` field with an index for performance:

```prisma
model Appointment {
  id        String    @id @default(uuid())
  // other fields...
  clinicId  String    // Tenant isolation field
  clinic    Clinic    @relation(fields: [clinicId], references: [id])
  
  @@index([clinicId]) // Index for better performance
}
```

## Usage Examples

### Marking Routes as Tenant-Specific

```typescript
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(TenantContextInterceptor)
export class AppointmentsController {
  @Post()
  @ClinicRoute()
  async createAppointment(@Body() data, @Request() req) {
    // Tenant ID is automatically extracted and available
    const clinicId = req.clinicContext?.clinicId;
    // ...
  }
}
```

### Setting and Using the Tenant Context

```typescript
@Injectable()
export class AppointmentService {
  constructor(private prisma: PrismaService) {}

  async getAppointments(filters) {
    try {
      // Set tenant context for automatic row-level filtering
      this.prisma.setCurrentTenantId(filters.clinicId);
      
      // The clinicId filter is automatically added by the middleware
      return this.prisma.appointment.findMany({
        where: {
          // No need to specify clinicId here
          // Other filters as needed
        }
      });
    } finally {
      // Clear tenant context after operation
      this.prisma.clearTenantId();
    }
  }
}
```

## Security Considerations

1. **Tenant Validation**: Every request is validated to ensure the tenant exists and is active
2. **User Authorization**: Users can only access tenants they are authorized for
3. **Data Isolation**: All queries automatically include tenant filters to prevent cross-tenant data access
4. **Early Filtering**: Row-level isolation is applied at the middleware level, making it extremely difficult to bypass

## Technical Implementation

### Single Database for All Tenants

The application uses a single database for all tenants with row-level isolation, which offers several advantages:

1. **Connection Pooling**: Optimizes database connections and performance
2. **Reduced Overhead**: No need to manage multiple databases or connections
3. **Simplified Code**: Services don't need to handle multiple database connections
4. **Easier Operations**: Centralized backup, monitoring, and management
5. **Simplified Schema Management**: Only one schema to maintain and migrate

The tenant context is maintained at the request level, ensuring that each request only sees data for the appropriate tenant.

### Prisma Implementation

The Prisma ORM is used with middleware to enforce row-level security:

1. **Middleware Approach**: Automatically adds the `clinicId` filter to all database operations
2. **Scope Management**: PrismaService is scoped to the request context
3. **Context Management**: The tenant context is established at the beginning of each request and cleared afterwards

## Database Indexing Strategy

To ensure optimal performance with row-level isolation, the following indexing strategy is implemented:

1. **Primary Tenant Field**: All tenant-specific tables have a `clinicId` field
2. **Composite Indexes**: Frequently queried fields are combined with `clinicId` in composite indexes
3. **Selective Indexing**: Only the most frequently used query patterns are indexed

## Performance Considerations

1. **Query Optimization**: All queries are optimized to work efficiently with tenant filters
2. **Index Usage**: Database monitoring ensures indexes are used appropriately
3. **Connection Pooling**: Database connections are efficiently managed and reused

## Future Improvements

1. **Tenant-Specific Configuration**: Support tenant-specific app configuration
2. **Tenant Analytics**: Track tenant-specific usage and performance metrics
3. **Cache Partitioning**: Implement tenant-aware caching to prevent cache pollution
4. **Rate Limiting**: Per-tenant rate limiting to prevent abuse
5. **Read Replicas**: Adding read replicas for high-traffic tenants
6. **Connection Pooling Optimization**: Fine-tune connection pools based on tenant activity 