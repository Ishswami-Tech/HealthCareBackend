# 🗄️ Database & Repository Patterns

## 🎯 Database Architecture
### Centralized Types Mapping (MANDATORY)
- Database-generated types (e.g., Prisma) live in `@database/types`.
- Business/domain types live in `@types` and act as the canonical contract.
- Implement mappers between `@database/types` and `@types`. Business logic and DTOs must consume `@types` only.

```typescript
// Example mapper (DB -> Domain)
import type { User as DbUser } from '@database/types';
import type { User } from '@types';

export function mapDbUserToDomain(db: DbUser): User {
  return {
    id: db.id,
    name: db.name,
    email: db.email,
    clinicId: db.clinicId,
    roleType: db.roleType
  };
}
```

Checklist:
- DTOs never import from `@database/types`.
- Services/controllers depend on `@types` and mappers, not DB models.

## 📈 Database at 10M Users
- Migrations Policy: always online, backward-compatible expand→migrate→contract; toggle-based rollouts; guard for long locks.
- Query Budgets: documented max scans/latency for hot queries; enforce indexes before merging changes that add filters.
- Partitioning/Shard Strategy: per-tenant/clinic partitioning where feasible; time-based partitioning for logs/audits.
- Read Scaling: replicas for read-heavy endpoints; lag-aware reads; fallback to primary if required.
- Indexing: composite indexes for high-cardinality filters; regular index health audits.
- Hot Paths: denormalized read models for top queries (e.g., appointment summaries) updated via events.
- Write Contention: batch writes where safe; queue buffering for spikes; idempotent upserts.
- Caching: Redis with tenant-aware keys; TTL + SWR; cache stampede protection (locks/jitter).
- Migrations: online, backward-compatible; expand-and-contract pattern; dark migrations for big tables.


### **Prisma Service Configuration**
```typescript
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client: PrismaClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService
  ) {
    this.client = new PrismaClient({
      datasources: {
        db: {
          url: this.configService.get<string>('DATABASE_URL')
        }
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' }
      ],
      errorFormat: 'pretty'
    });

    // Set up logging handlers
    this.client.$on('query', (e) => {
      this.logger.debug('Query executed', {
        query: e.query,
        params: e.params,
        duration: e.duration
      });
    });

    this.client.$on('error', (e) => {
      this.logger.error('Prisma error', { error: e.message });
    });
  }

  get $client(): PrismaClient {
    return this.client;
  }

  async onModuleInit() {
    await this.client.$connect();
    this.logger.info('Database connected successfully');
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    this.logger.info('Database disconnected');
  }

  // Health check for database connectivity
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', { error });
      return false;
    }
  }

  // Transaction support with timeout
  async transaction<T>(
    fn: (tx: PrismaClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number; isolationLevel?: string }
  ): Promise<T> {
    return this.client.$transaction(fn, {
      timeout: options?.timeout || 5000,
      maxWait: options?.maxWait || 2000
    });
  }
}
```

### **Database Usage Patterns**
```typescript
// Standard service usage
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findUser(id: string): Promise<User | null> {
    return this.prisma.$client.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        clinicId: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async findUsersByClinic(clinicId: string): Promise<User[]> {
    return this.prisma.$client.user.findMany({
      where: { clinicId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}

// Multi-tenant pattern with clinic isolation
@Injectable()
export class AppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  async findAppointments(clinicId: string): Promise<Appointment[]> {
    return this.prisma.$client.appointment.findMany({
      where: { clinicId },
      include: {
        patient: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        doctor: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        }
      },
      orderBy: { appointmentDateTime: 'asc' }
    });
  }
}
```

## 🔧 Repository Pattern Implementation

### **Base Repository Interface**
```typescript
export interface IBaseRepository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options?: FindManyOptions<T>): Promise<T[]>;
  create(data: CreateData<T>): Promise<T>;
  update(id: string, data: UpdateData<T>): Promise<T>;
  delete(id: string): Promise<void>;
  count(where?: WhereCondition<T>): Promise<number>;
}

export interface FindManyOptions<T> {
  where?: WhereCondition<T>;
  orderBy?: OrderByCondition<T>;
  skip?: number;
  take?: number;
  include?: IncludeCondition<T>;
}
```

### **Concrete Repository Implementation**
```typescript
@Injectable()
export class UserRepository implements IBaseRepository<User> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggingService
  ) {}

  async findById(id: string, clinicId?: string): Promise<User | null> {
    const where: any = { id };
    if (clinicId) {
      where.clinicId = clinicId; // Clinic isolation
    }

    return this.prisma.$client.user.findUnique({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        clinicId: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async findMany(options: FindManyOptions<User> = {}): Promise<User[]> {
    return this.prisma.$client.user.findMany({
      where: options.where,
      orderBy: options.orderBy || { createdAt: 'desc' },
      skip: options.skip,
      take: options.take,
      include: options.include
    });
  }

  async create(data: CreateUserData): Promise<User> {
    this.logger.info('Creating user', { email: data.email });

    return this.prisma.$client.user.create({
      data,
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        clinicId: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    this.logger.info('Updating user', { userId: id });

    return this.prisma.$client.user.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date()
      },
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        clinicId: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async delete(id: string): Promise<void> {
    this.logger.warn('Deleting user', { userId: id });

    await this.prisma.$client.user.delete({
      where: { id }
    });
  }

  async softDelete(id: string): Promise<User> {
    return this.prisma.$client.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date()
      }
    });
  }

  async count(where?: any): Promise<number> {
    return this.prisma.$client.user.count({ where });
  }

  // Domain-specific methods
  async findByEmail(email: string, clinicId?: string): Promise<User | null> {
    const where: any = { email };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    return this.prisma.$client.user.findUnique({ where });
  }

  async findByRole(roleType: string, clinicId?: string): Promise<User[]> {
    const where: any = { roleType, isActive: true };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    return this.prisma.$client.user.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
  }

  async findActiveUsers(clinicId?: string): Promise<User[]> {
    const where: any = { isActive: true, isVerified: true };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    return this.prisma.$client.user.findMany({
      where,
      orderBy: { name: 'asc' }
    });
  }
}
```

## 🔍 Query Optimization

### **Efficient Query Patterns**
```typescript
// ✅ DO - Use select to limit fields
async findUsers(clinicId?: string): Promise<User[]> {
  const where: any = { isActive: true };
  if (clinicId) {
    where.clinicId = clinicId;
  }

  return this.prisma.$client.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      roleType: true,
      clinicId: true
      // Only select needed fields
    },
    orderBy: { name: 'asc' }
  });
}

// ✅ DO - Use include for relations with proper filtering
async findUserWithAppointments(
  id: string,
  clinicId?: string
): Promise<UserWithAppointments> {
  const where: any = { id };
  if (clinicId) {
    where.clinicId = clinicId;
  }

  return this.prisma.$client.user.findUnique({
    where,
    include: {
      patient: {
        include: {
          appointments: {
            where: {
              appointmentDateTime: { gte: new Date() },
              status: { in: ['SCHEDULED', 'CONFIRMED'] }
            },
            select: {
              id: true,
              appointmentDateTime: true,
              status: true,
              doctor: {
                select: {
                  id: true,
                  user: {
                    select: { name: true }
                  }
                }
              }
            },
            orderBy: { appointmentDateTime: 'asc' },
            take: 10 // Limit results
          }
        }
      }
    }
  });
}

// ✅ DO - Use pagination with cursor-based or offset-based approach
async findUsersWithPagination(
  page: number,
  limit: number,
  clinicId?: string
): Promise<PaginatedUsers> {
  const skip = (page - 1) * limit;
  const where: any = { isActive: true };
  if (clinicId) {
    where.clinicId = clinicId;
  }

  const [users, total] = await Promise.all([
    this.prisma.$client.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        createdAt: true
      }
    }),
    this.prisma.$client.user.count({ where })
  ]);

  return {
    users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrevious: page > 1
  };
}

// ❌ DON'T - Fetch all fields and relations
async findUsers(): Promise<User[]> {
  return this.prisma.$client.user.findMany(); // Fetches everything, no clinic isolation
}
```

### **Transaction Management**
```typescript
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggingService,
    private readonly eventService: EventService
  ) {}

  async createUserWithProfile(
    userData: CreateUserData,
    profileData: CreateProfileData
  ): Promise<{ user: User; profile: Profile }> {
    return this.prisma.transaction(async (tx) => {
      // Create user first
      const user = await tx.user.create({
        data: userData
      });

      this.logger.info('User created in transaction', { userId: user.id });

      // Create patient profile with user reference
      const profile = await tx.patientProfile.create({
        data: {
          ...profileData,
          userId: user.id
        }
      });

      this.logger.info('Patient profile created', { profileId: profile.id });

      // Emit event for user creation (outside transaction for better performance)
      if (this.eventService) {
        await this.eventService.emitEnterprise('user.created', {
          eventId: `user-created-${user.id}`,
          eventType: 'user.created',
          category: EventCategory.USER_ACTIVITY,
          priority: EventPriority.HIGH,
          timestamp: new Date().toISOString(),
          source: 'UserService',
          version: '1.0.0',
          userId: user.id,
          clinicId: user.clinicId,
          payload: { user, profile }
        });
      }

      return { user, profile };
    });
  }

  async transferAppointment(
    appointmentId: string,
    fromDoctorId: string,
    toDoctorId: string,
    reason: string,
    requestedBy: string
  ): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      // Verify appointment exists and is transferable
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: true }
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
        throw new BadRequestException('Cannot transfer completed or cancelled appointment');
      }

      // Update appointment
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          doctorId: toDoctorId,
          updatedAt: new Date(),
          updatedBy: requestedBy
        }
      });

      // Create audit log for the transfer
      await tx.appointmentAuditLog.create({
        data: {
          appointmentId,
          action: 'TRANSFERRED',
          previousDoctorId: fromDoctorId,
          newDoctorId: toDoctorId,
          reason,
          performedBy: requestedBy,
          timestamp: new Date()
        }
      });

      // Update doctor availability slots
      await tx.doctorAvailability.updateMany({
        where: {
          doctorId: fromDoctorId,
          appointmentId,
          status: 'BOOKED'
        },
        data: {
          status: 'AVAILABLE',
          appointmentId: null
        }
      });

      await tx.doctorAvailability.updateMany({
        where: {
          doctorId: toDoctorId,
          slotDateTime: appointment.appointmentDateTime,
          status: 'AVAILABLE'
        },
        data: {
          status: 'BOOKED',
          appointmentId
        }
      });

      this.logger.info('Appointment transferred successfully', {
        appointmentId,
        fromDoctorId,
        toDoctorId,
        requestedBy
      });
    }, { timeout: 10000 }); // 10 second timeout for complex transaction
  }
}
```

## 📊 Advanced Query Patterns

### **Complex Filtering**
```typescript
@Injectable()
export class AppointmentRepository {
  async findAppointments(filters: AppointmentFilters): Promise<Appointment[]> {
    const where: any = {};

    // Date range filtering
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) {
        where.date.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.date.lte = filters.endDate;
      }
    }

    // Status filtering
    if (filters.status) {
      where.status = { in: filters.status };
    }

    // Doctor filtering
    if (filters.doctorId) {
      where.doctorId = filters.doctorId;
    }

    // Patient search
    if (filters.patientName) {
      where.patient = {
        user: {
          name: {
            contains: filters.patientName,
            mode: 'insensitive'
          }
        }
      };
    }

    return this.prisma.healthcare.appointment.findMany({
      where,
      include: {
        patient: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        doctor: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      },
      orderBy: { date: 'asc' }
    });
  }
}
```

### **Aggregation Queries**
```typescript
@Injectable()
export class AnalyticsRepository {
  async getAppointmentStats(clinicId: string): Promise<AppointmentStats> {
    const stats = await this.prisma.healthcare.appointment.aggregate({
      where: { clinicId },
      _count: {
        id: true
      },
      _avg: {
        duration: true
      }
    });

    const statusCounts = await this.prisma.healthcare.appointment.groupBy({
      by: ['status'],
      where: { clinicId },
      _count: {
        id: true
      }
    });

    return {
      totalAppointments: stats._count.id,
      averageDuration: stats._avg.duration,
      statusBreakdown: statusCounts.map(item => ({
        status: item.status,
        count: item._count.id
      }))
    };
  }

  async getDoctorPerformance(doctorId: string): Promise<DoctorPerformance> {
    const [appointmentStats, patientStats] = await Promise.all([
      this.prisma.healthcare.appointment.aggregate({
        where: { doctorId },
        _count: { id: true },
        _avg: { rating: true }
      }),
      this.prisma.healthcare.appointment.findMany({
        where: { doctorId },
        distinct: ['patientId'],
        select: { patientId: true }
      })
    ]);

    return {
      totalAppointments: appointmentStats._count.id,
      averageRating: appointmentStats._avg.rating,
      uniquePatients: patientStats.length
    };
  }
}
```

## 🔄 Database Commands

### **Migration Commands**
```bash
# Generate Prisma clients
npm run db:generate         # Both schemas
npm run db:generate:healthcare
npm run db:generate:fashion

# Run migrations
npm run db:migrate          # Both databases
npm run db:migrate:healthcare
npm run db:migrate:fashion

# Create new migration
npm run db:migrate:create:healthcare -- --name add_user_table
npm run db:migrate:create:fashion -- --name add_studio_table

# Database UI
npm run db:studio:healthcare
npm run db:studio:fashion

# Reset (development only)
npm run db:reset:healthcare
npm run db:reset:fashion

# Deploy migrations (production)
npm run db:deploy:healthcare
npm run db:deploy:fashion
```

### **Seeding Data**
```typescript
// prisma/healthcare/seed.ts
import { PrismaClient } from '@prisma/healthcare-client';

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@healthcare.com' },
    update: {},
    create: {
      email: 'admin@healthcare.com',
      name: 'System Admin',
      roleType: 'SUPER_ADMIN',
      isVerified: true,
      password: await bcrypt.hash('admin123', 10)
    }
  });

  // Create sample clinic
  const clinic = await prisma.clinic.upsert({
    where: { name: 'Main Clinic' },
    update: {},
    create: {
      name: 'Main Clinic',
      address: '123 Health St',
      phone: '+1234567890',
      email: 'info@mainclinic.com'
    }
  });

  console.log({ admin, clinic });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

## 🚫 Anti-Patterns to Avoid

### **❌ Don't Do This**
```typescript
// Don't use raw SQL without proper escaping
await prisma.$executeRaw`SELECT * FROM users WHERE id = ${userId}`; // SQL injection risk

// Don't fetch unnecessary data
const users = await prisma.user.findMany(); // Fetches all fields

// Don't use N+1 queries
for (const user of users) {
  const appointments = await prisma.appointment.findMany({
    where: { userId: user.id }
  }); // N+1 problem
}

// Don't ignore transactions for related operations
await prisma.user.create({ data: userData });
await prisma.profile.create({ data: profileData }); // Not atomic
```

### **✅ Do This Instead**
```typescript
// Use parameterized queries
await prisma.$executeRaw`SELECT * FROM users WHERE id = ${userId}`;

// Select only needed fields
const users = await prisma.user.findMany({
  select: { id: true, name: true, email: true }
});

// Use include to avoid N+1
const usersWithAppointments = await prisma.user.findMany({
  include: {
    appointments: true
  }
});

// Use transactions for related operations
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: userData });
  await tx.profile.create({ data: { ...profileData, userId: user.id } });
});
```

---

**💡 These database patterns ensure optimal performance, data integrity, and maintainable code with proper separation of concerns.**

**Last Updated**: December 2024
