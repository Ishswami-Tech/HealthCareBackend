# 🗄️ Database & Repository Patterns

## 🎯 Multi-Database Architecture

### **Prisma Service Configuration**
```typescript
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private healthcareClient: PrismaHealthcareClient;
  private fashionClient: PrismaFashionClient;

  constructor(private configService: ConfigService) {
    this.healthcareClient = new PrismaHealthcareClient({
      datasources: {
        db: { url: this.configService.get('DATABASE_URL') }
      },
      log: ['query', 'info', 'warn', 'error']
    });
    
    this.fashionClient = new PrismaFashionClient({
      datasources: {
        db: { url: this.configService.get('FASHION_DATABASE_URL') }
      },
      log: ['query', 'info', 'warn', 'error']
    });
  }

  get healthcare(): PrismaHealthcareClient {
    return this.healthcareClient;
  }

  get fashion(): PrismaFashionClient {
    return this.fashionClient;
  }

  async onModuleInit() {
    await this.healthcareClient.$connect();
    await this.fashionClient.$connect();
  }

  async onModuleDestroy() {
    await this.healthcareClient.$disconnect();
    await this.fashionClient.$disconnect();
  }
}
```

### **Database Usage Patterns**
```typescript
// Healthcare domain usage
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findUser(id: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { id }
    });
  }
}

// Fashion domain usage
@Injectable()
export class StudioService {
  constructor(private readonly prisma: PrismaService) {}

  async findStudio(id: string): Promise<Studio | null> {
    return this.prisma.fashion.studio.findUnique({
      where: { id }
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
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async findMany(options: FindManyOptions<User> = {}): Promise<User[]> {
    return this.prisma.healthcare.user.findMany({
      where: options.where,
      orderBy: options.orderBy || { createdAt: 'desc' },
      skip: options.skip,
      take: options.take,
      include: options.include
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.healthcare.user.create({
      data,
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    return this.prisma.healthcare.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        roleType: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.healthcare.user.delete({
      where: { id }
    });
  }

  async count(where?: any): Promise<number> {
    return this.prisma.healthcare.user.count({ where });
  }

  // Domain-specific methods
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { email }
    });
  }

  async findByRole(roleType: string): Promise<User[]> {
    return this.prisma.healthcare.user.findMany({
      where: { roleType }
    });
  }
}
```

## 🔍 Query Optimization

### **Efficient Query Patterns**
```typescript
// ✅ DO - Use select to limit fields
async findUsers(): Promise<User[]> {
  return this.prisma.healthcare.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      // Only select needed fields
    }
  });
}

// ✅ DO - Use include for relations
async findUserWithAppointments(id: string): Promise<UserWithAppointments> {
  return this.prisma.healthcare.user.findUnique({
    where: { id },
    include: {
      appointments: {
        select: {
          id: true,
          date: true,
          status: true
        },
        where: {
          date: { gte: new Date() }
        },
        orderBy: { date: 'asc' }
      }
    }
  });
}

// ✅ DO - Use pagination
async findUsersWithPagination(page: number, limit: number): Promise<PaginatedUsers> {
  const skip = (page - 1) * limit;
  
  const [users, total] = await Promise.all([
    this.prisma.healthcare.user.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    }),
    this.prisma.healthcare.user.count()
  ]);

  return {
    users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

// ❌ DON'T - Fetch all fields and relations
async findUsers(): Promise<User[]> {
  return this.prisma.healthcare.user.findMany(); // Fetches everything
}
```

### **Transaction Management**
```typescript
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserWithProfile(
    userData: CreateUserData,
    profileData: CreateProfileData
  ): Promise<{ user: User; profile: Profile }> {
    return this.prisma.healthcare.$transaction(async (tx) => {
      // Create user first
      const user = await tx.user.create({
        data: userData
      });

      // Create profile with user reference
      const profile = await tx.profile.create({
        data: {
          ...profileData,
          userId: user.id
        }
      });

      return { user, profile };
    });
  }

  async transferAppointment(
    appointmentId: string,
    fromDoctorId: string,
    toDoctorId: string
  ): Promise<void> {
    await this.prisma.healthcare.$transaction(async (tx) => {
      // Update appointment
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { doctorId: toDoctorId }
      });

      // Log the transfer
      await tx.appointmentLog.create({
        data: {
          appointmentId,
          action: 'TRANSFERRED',
          fromDoctorId,
          toDoctorId,
          timestamp: new Date()
        }
      });

      // Update doctor schedules
      await tx.doctorSchedule.updateMany({
        where: { doctorId: fromDoctorId, appointmentId },
        data: { status: 'AVAILABLE' }
      });

      await tx.doctorSchedule.updateMany({
        where: { doctorId: toDoctorId, appointmentId },
        data: { status: 'BOOKED' }
      });
    });
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
