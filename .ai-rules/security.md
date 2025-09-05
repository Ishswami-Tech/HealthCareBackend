# 🔒 Security Guidelines

## 🛡️ Authentication & Authorization

### **JWT Authentication Implementation**
```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService
  ) {}

  async login(credentials: LoginDto): Promise<AuthResponse> {
    // Validate user credentials
    const user = await this.validateUser(credentials.email, credentials.password);
    
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const payload = { 
      sub: user.id, 
      email: user.email, 
      roles: user.roles,
      clinicId: user.clinicId 
    };
    
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m' // Short-lived access token
    });
    
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d', // Longer-lived refresh token
      secret: this.configService.get('JWT_REFRESH_SECRET')
    });

    // Store refresh token (hashed)
    await this.storeRefreshToken(user.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user)
    };
  }

  private async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userService.findByEmail(email);
    
    if (user && await bcrypt.compare(password, user.password)) {
      return user;
    }
    
    return null;
  }

  private sanitizeUser(user: User): SafeUser {
    const { password, refreshToken, ...safeUser } = user;
    return safeUser;
  }
}
```

### **Role-Based Access Control (RBAC)**
```typescript
// Role definitions
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  NURSE = 'NURSE',
  PATIENT = 'PATIENT',
  RECEPTIONIST = 'RECEPTIONIST'
}

// Permission definitions
export enum Permission {
  // User management
  CREATE_USER = 'CREATE_USER',
  READ_USER = 'READ_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',
  
  // Medical records
  CREATE_MEDICAL_RECORD = 'CREATE_MEDICAL_RECORD',
  READ_MEDICAL_RECORD = 'READ_MEDICAL_RECORD',
  UPDATE_MEDICAL_RECORD = 'UPDATE_MEDICAL_RECORD',
  
  // Appointments
  CREATE_APPOINTMENT = 'CREATE_APPOINTMENT',
  READ_APPOINTMENT = 'READ_APPOINTMENT',
  UPDATE_APPOINTMENT = 'UPDATE_APPOINTMENT',
  CANCEL_APPOINTMENT = 'CANCEL_APPOINTMENT'
}

// Role-permission mapping
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
  [UserRole.ADMIN]: [
    Permission.CREATE_USER,
    Permission.READ_USER,
    Permission.UPDATE_USER,
    Permission.READ_MEDICAL_RECORD,
    Permission.CREATE_APPOINTMENT,
    Permission.READ_APPOINTMENT,
    Permission.UPDATE_APPOINTMENT
  ],
  [UserRole.DOCTOR]: [
    Permission.READ_USER,
    Permission.CREATE_MEDICAL_RECORD,
    Permission.READ_MEDICAL_RECORD,
    Permission.UPDATE_MEDICAL_RECORD,
    Permission.READ_APPOINTMENT,
    Permission.UPDATE_APPOINTMENT
  ],
  [UserRole.NURSE]: [
    Permission.READ_USER,
    Permission.READ_MEDICAL_RECORD,
    Permission.READ_APPOINTMENT,
    Permission.UPDATE_APPOINTMENT
  ],
  [UserRole.PATIENT]: [
    Permission.READ_APPOINTMENT
  ],
  [UserRole.RECEPTIONIST]: [
    Permission.CREATE_APPOINTMENT,
    Permission.READ_APPOINTMENT,
    Permission.UPDATE_APPOINTMENT,
    Permission.CANCEL_APPOINTMENT
  ]
};
```

### **Permission Guard Implementation**
```typescript
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>('permissions', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    
    if (!user) {
      return false;
    }

    const userPermissions = this.getUserPermissions(user.roles);
    
    return requiredPermissions.every(permission => 
      userPermissions.includes(permission)
    );
  }

  private getUserPermissions(roles: UserRole[]): Permission[] {
    const permissions = new Set<Permission>();
    
    roles.forEach(role => {
      ROLE_PERMISSIONS[role]?.forEach(permission => {
        permissions.add(permission);
      });
    });
    
    return Array.from(permissions);
  }
}

// Permission decorator
export const RequirePermissions = (...permissions: Permission[]) => 
  SetMetadata('permissions', permissions);

// Usage in controllers
@Controller('medical-records')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MedicalRecordsController {
  @Post()
  @RequirePermissions(Permission.CREATE_MEDICAL_RECORD)
  async create(@Body() createDto: CreateMedicalRecordDto) {
    // Only users with CREATE_MEDICAL_RECORD permission can access
  }

  @Get(':id')
  @RequirePermissions(Permission.READ_MEDICAL_RECORD)
  async findOne(@Param('id') id: string) {
    // Only users with READ_MEDICAL_RECORD permission can access
  }
}
```

## 🔐 Input Validation & Sanitization

### **Comprehensive DTO Validation**
```typescript
export class CreateUserDto {
  @ApiProperty({ description: 'User full name' })
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  @Matches(/^[a-zA-Z\s]+$/, { message: 'Name can only contain letters and spaces' })
  name: string;

  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  @MaxLength(100)
  email: string;

  @ApiProperty({ description: 'Strong password' })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
  })
  password: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone?: string;

  @ApiProperty({ description: 'User role' })
  @IsEnum(UserRole)
  role: UserRole;
}
```

### **Custom Validation Decorators**
```typescript
// Medical record number validator
export function IsMedicalRecordNumber(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isMedicalRecordNumber',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return typeof value === 'string' && /^MR\d{8}$/.test(value);
        },
        defaultMessage() {
          return 'Medical record number must be in format MR12345678';
        }
      }
    });
  };
}

// Usage
export class CreateMedicalRecordDto {
  @IsMedicalRecordNumber()
  recordNumber: string;
}
```

## 🔒 Data Protection & Encryption

### **Sensitive Data Encryption**
```typescript
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey: Buffer;

  constructor(private configService: ConfigService) {
    this.secretKey = Buffer.from(
      this.configService.get<string>('ENCRYPTION_KEY'),
      'hex'
    );
  }

  encrypt(text: string): EncryptedData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.secretKey);
    cipher.setAAD(Buffer.from('healthcare-app'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decrypt(encryptedData: EncryptedData): string {
    const decipher = crypto.createDecipher(this.algorithm, this.secretKey);
    decipher.setAAD(Buffer.from('healthcare-app'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

// Usage for sensitive medical data
@Injectable()
export class MedicalRecordService {
  constructor(
    private readonly encryptionService: EncryptionService,
    private readonly prisma: PrismaService
  ) {}

  async createMedicalRecord(data: CreateMedicalRecordDto): Promise<MedicalRecord> {
    // Encrypt sensitive fields
    const encryptedDiagnosis = this.encryptionService.encrypt(data.diagnosis);
    const encryptedTreatment = this.encryptionService.encrypt(data.treatment);

    return this.prisma.healthcare.medicalRecord.create({
      data: {
        ...data,
        diagnosis: JSON.stringify(encryptedDiagnosis),
        treatment: JSON.stringify(encryptedTreatment)
      }
    });
  }

  async getMedicalRecord(id: string): Promise<MedicalRecord> {
    const record = await this.prisma.healthcare.medicalRecord.findUnique({
      where: { id }
    });

    if (record) {
      // Decrypt sensitive fields
      const diagnosisData = JSON.parse(record.diagnosis);
      const treatmentData = JSON.parse(record.treatment);

      record.diagnosis = this.encryptionService.decrypt(diagnosisData);
      record.treatment = this.encryptionService.decrypt(treatmentData);
    }

    return record;
  }
}
```

## 🛡️ Security Middleware & Headers

### **Security Headers Configuration**
```typescript
// In main.ts
import helmet from '@fastify/helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // CORS configuration
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://yourdomain.com'] 
      : ['http://localhost:4000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Clinic-ID']
  });

  await app.listen(8088, '0.0.0.0');
}
```

### **Rate Limiting**
```typescript
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly requests = new Map<string, number[]>();
  private readonly windowMs = 15 * 60 * 1000; // 15 minutes
  private readonly maxRequests = 100; // Max requests per window

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = this.getKey(request);
    
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Get existing requests for this key
    const requests = this.requests.get(key) || [];
    
    // Filter out old requests
    const recentRequests = requests.filter(time => time > windowStart);
    
    // Check if limit exceeded
    if (recentRequests.length >= this.maxRequests) {
      throw new TooManyRequestsException('Rate limit exceeded');
    }
    
    // Add current request
    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    
    return true;
  }

  private getKey(request: any): string {
    // Use IP + user ID for authenticated requests
    const ip = request.ip || request.connection.remoteAddress;
    const userId = request.user?.id;
    
    return userId ? `${ip}:${userId}` : ip;
  }
}
```

## 🔍 Audit Logging

### **Audit Trail Implementation**
```typescript
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logAction(action: AuditAction): Promise<void> {
    await this.prisma.healthcare.auditLog.create({
      data: {
        userId: action.userId,
        action: action.action,
        resource: action.resource,
        resourceId: action.resourceId,
        details: action.details,
        ipAddress: action.ipAddress,
        userAgent: action.userAgent,
        timestamp: new Date()
      }
    });
  }
}

// Audit decorator
export function Audit(action: string, resource: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const result = await method.apply(this, args);
      
      // Log the action (implement context extraction)
      await this.auditService.logAction({
        userId: this.getCurrentUserId(),
        action,
        resource,
        resourceId: result?.id,
        details: { args: this.sanitizeArgs(args) },
        ipAddress: this.getClientIp(),
        userAgent: this.getUserAgent()
      });
      
      return result;
    };
  };
}

// Usage
@Injectable()
export class UserService {
  @Audit('CREATE', 'USER')
  async createUser(data: CreateUserDto): Promise<User> {
    // Implementation
  }

  @Audit('UPDATE', 'USER')
  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    // Implementation
  }
}
```

## 🚫 Security Anti-Patterns

### **❌ Don't Do This**
```typescript
// Don't store passwords in plain text
const user = { password: 'plaintext123' };

// Don't use weak JWT secrets
const secret = 'secret';

// Don't expose sensitive data in responses
return {
  user: {
    id: user.id,
    password: user.password, // Exposed!
    ssn: user.ssn // Exposed!
  }
};

// Don't skip input validation
@Post()
async create(@Body() data: any) { // No validation

// Don't use SQL injection vulnerable queries
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

### **✅ Do This Instead**
```typescript
// Hash passwords properly
const hashedPassword = await bcrypt.hash(password, 12);

// Use strong JWT secrets
const secret = process.env.JWT_SECRET; // 256-bit random string

// Sanitize response data
return {
  user: {
    id: user.id,
    name: user.name,
    email: user.email
    // No sensitive fields
  }
};

// Always validate input
@Post()
async create(@Body() createUserDto: CreateUserDto) { // Validated DTO

// Use parameterized queries
const user = await prisma.user.findUnique({ where: { id: userId } });
```

---

**💡 Security is paramount in healthcare applications. Always follow HIPAA compliance requirements and implement defense-in-depth strategies.**

**Last Updated**: December 2024
