# 🏗️ Architecture & Design Patterns

## 🎯 SOLID & DRY Principles

### **SOLID Principles**
- **S**ingle Responsibility: Each class/function has one reason to change
- **O**pen/Closed: Open for extension, closed for modification
- **L**iskov Substitution: Derived classes must be substitutable for base classes
- **I**nterface Segregation: Many specific interfaces over one general interface
- **D**ependency Inversion: Depend on abstractions, not concretions

### **DRY (Don't Repeat Yourself)**
- Extract common logic into utilities, services, or decorators
- Use composition over inheritance
- Create reusable components and patterns
- Avoid code duplication across modules

## 📁 Project Structure

### **Library Organization**
```
libs/
├── communication/      # Messaging, events, socket
│   ├── messaging/     # Email, SMS, notifications
│   ├── events/        # Event emitters and handlers
│   └── socket/        # WebSocket implementation
├── core/              # Core utilities and filters
│   ├── filters/       # Exception filters
│   ├── guards/        # Authentication guards
│   └── interceptors/  # Request/response interceptors
├── dtos/              # Data transfer objects
│   ├── auth/          # Authentication DTOs
│   ├── users/         # User-related DTOs
│   └── shared/        # Common DTOs
├── infrastructure/    # Infrastructure services
│   ├── database/      # Prisma service and config
│   ├── cache/         # Redis service
│   ├── logging/       # Logging service
│   ├── queue/         # BullMQ service
│   └── permissions/   # Permission management
├── security/          # Security components
│   ├── interceptors/  # Security interceptors
│   ├── middleware/    # Security middleware
│   └── rate-limiting/ # Rate limiting
├── services/          # Business logic modules
│   ├── auth/          # Authentication service
│   ├── users/         # User management
│   ├── appointments/  # Appointment management
│   └── health/        # Health monitoring
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
│   ├── QR/            # QR code utilities
│   ├── encryption/    # Encryption utilities
│   └── validation/    # Custom validators
└── validations/       # Validation pipes and rules
```

### **Domain Organization**
```
src/
├── domains/           # Domain-specific modules
│   ├── clinic/        # Healthcare domain
│   │   ├── controllers/
│   │   ├── services/
│   │   └── modules/
│   └── fashion/       # Fashion domain
│       ├── controllers/
│       ├── services/
│       └── modules/
├── config/            # Configuration files
├── shared/            # Shared modules
└── main.ts           # Application bootstrap
```

## 🔧 Design Patterns

### **Repository Pattern**
```typescript
// Abstract repository interface
export abstract class BaseRepository<T> {
  abstract findById(id: string): Promise<T | null>;
  abstract create(data: Partial<T>): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

// Concrete implementation
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.healthcare.user.create({ data });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.healthcare.user.findUnique({
      where: { email }
    });
  }
}
```

### **Factory Pattern**
```typescript
// Service factory for different domains
@Injectable()
export class ServiceFactory {
  constructor(
    private readonly healthcareUserService: HealthcareUserService,
    private readonly fashionUserService: FashionUserService
  ) {}

  getUserService(domain: 'healthcare' | 'fashion'): UserServiceInterface {
    switch (domain) {
      case 'healthcare':
        return this.healthcareUserService;
      case 'fashion':
        return this.fashionUserService;
      default:
        throw new Error(`Unknown domain: ${domain}`);
    }
  }
}
```

### **Strategy Pattern**
```typescript
// Authentication strategy interface
export interface AuthStrategy {
  authenticate(credentials: any): Promise<User | null>;
}

// JWT strategy implementation
@Injectable()
export class JwtAuthStrategy implements AuthStrategy {
  async authenticate(token: string): Promise<User | null> {
    // JWT authentication logic
  }
}

// OAuth strategy implementation
@Injectable()
export class OAuthStrategy implements AuthStrategy {
  async authenticate(oauthData: any): Promise<User | null> {
    // OAuth authentication logic
  }
}

// Context using strategies
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtStrategy: JwtAuthStrategy,
    private readonly oauthStrategy: OAuthStrategy
  ) {}

  async authenticate(type: 'jwt' | 'oauth', credentials: any): Promise<User | null> {
    const strategy = type === 'jwt' ? this.jwtStrategy : this.oauthStrategy;
    return strategy.authenticate(credentials);
  }
}
```

### **Decorator Pattern**
```typescript
// Caching decorator
export function Cacheable(ttl: number = 3600) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${target.constructor.name}:${propertyName}:${JSON.stringify(args)}`;
      const cached = await this.cache.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const result = await method.apply(this, args);
      await this.cache.set(cacheKey, JSON.stringify(result), ttl);
      
      return result;
    };
  };
}

// Usage
@Injectable()
export class UserService {
  @Cacheable(3600) // Cache for 1 hour
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }
}
```

## 🔄 Event-Driven Architecture

### **Event Emitter Pattern**
```typescript
// Event definitions
export interface UserEvents {
  'user.created': { user: User };
  'user.updated': { user: User; changes: Partial<User> };
  'user.deleted': { userId: string };
}

// Service with event emission
@Injectable()
export class UserService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly userRepository: UserRepository
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const user = await this.userRepository.create(data);
    
    // Emit event for other services to react
    this.eventEmitter.emit('user.created', { user });
    
    return user;
  }
}

// Event listener
@Injectable()
export class NotificationService {
  @OnEvent('user.created')
  async handleUserCreated(payload: { user: User }) {
    await this.sendWelcomeEmail(payload.user.email);
  }

  @OnEvent('user.updated')
  async handleUserUpdated(payload: { user: User; changes: Partial<User> }) {
    if (payload.changes.email) {
      await this.sendEmailChangeNotification(payload.user);
    }
  }
}
```

## 🗄️ Multi-Database Architecture

### **Database Context Pattern**
```typescript
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private healthcareClient: PrismaHealthcareClient;
  private fashionClient: PrismaFashionClient;

  constructor(private configService: ConfigService) {
    this.healthcareClient = new PrismaHealthcareClient({
      datasources: {
        db: { url: this.configService.get('DATABASE_URL') }
      }
    });
    
    this.fashionClient = new PrismaFashionClient({
      datasources: {
        db: { url: this.configService.get('FASHION_DATABASE_URL') }
      }
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

## 🔧 Dependency Injection Patterns

### **Interface Segregation**
```typescript
// Specific interfaces for different concerns
export interface IUserReader {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export interface IUserWriter {
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  delete(id: string): Promise<void>;
}

export interface IUserService extends IUserReader, IUserWriter {
  // Combined interface
}

// Implementation
@Injectable()
export class UserService implements IUserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService
  ) {}

  // Implement all interface methods
}
```

### **Provider Configuration**
```typescript
// Module with proper DI configuration
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CacheModule
  ],
  providers: [
    // Service providers
    UserService,
    AuthService,
    
    // Repository providers
    {
      provide: 'IUserRepository',
      useClass: UserRepository
    },
    
    // Factory providers
    {
      provide: 'UserServiceFactory',
      useFactory: (
        healthcareService: HealthcareUserService,
        fashionService: FashionUserService
      ) => new ServiceFactory(healthcareService, fashionService),
      inject: [HealthcareUserService, FashionUserService]
    }
  ],
  controllers: [UserController],
  exports: [UserService, 'IUserRepository']
})
export class UserModule {}
```

## 🔄 Module Organization

### **Feature Module Pattern**
```typescript
// Core module for shared functionality
@Global()
@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    LoggingModule,
    CacheModule
  ],
  exports: [
    DatabaseModule,
    LoggingModule,
    CacheModule
  ]
})
export class CoreModule {}

// Feature module
@Module({
  imports: [
    CoreModule, // Import shared functionality
    AuthModule  // Import related modules
  ],
  providers: [
    UserService,
    UserRepository
  ],
  controllers: [UserController],
  exports: [UserService] // Export for other modules
})
export class UserModule {}

// Domain module
@Module({
  imports: [
    UserModule,
    AppointmentModule,
    ClinicModule
  ]
})
export class HealthcareModule {}
```

## 🚫 Anti-Patterns to Avoid

### **❌ Avoid These Patterns**
```typescript
// God Object - too many responsibilities
class UserService {
  createUser() {}
  sendEmail() {}
  processPayment() {}
  generateReport() {}
  manageInventory() {}
  // ... 50+ methods
}

// Tight Coupling - direct dependencies
class UserService {
  constructor() {
    this.database = new PostgresDatabase(); // Hard dependency
    this.emailService = new EmailService(); // Hard dependency
  }
}

// Violation of Interface Segregation
interface IUserService {
  // User methods
  createUser(): void;
  updateUser(): void;
  
  // Admin methods (not needed by all clients)
  deleteAllUsers(): void;
  exportUserData(): void;
  
  // Reporting methods (not needed by all clients)
  generateUserReport(): void;
  analyzeUserBehavior(): void;
}
```

### **✅ Correct Patterns**
```typescript
// Single Responsibility - focused classes
class UserService {
  createUser() {}
  updateUser() {}
  findUser() {}
}

class EmailService {
  sendEmail() {}
  sendBulkEmail() {}
}

// Dependency Inversion - depend on abstractions
class UserService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly emailService: IEmailService
  ) {}
}

// Interface Segregation - specific interfaces
interface IUserReader {
  findById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User>;
}

interface IUserWriter {
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
}

interface IUserAdmin {
  deleteAllUsers(): Promise<void>;
  exportUserData(): Promise<Buffer>;
}
```

---

**💡 These architectural patterns ensure scalable, maintainable, and testable code that follows SOLID principles and industry best practices.**

**Last Updated**: December 2024
