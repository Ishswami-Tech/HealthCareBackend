
# 📝 Coding Standards - Healthcare Backend

## 🎯 Core Principles

### **Code Quality Standards**
- **TypeScript Strict Mode**: Always enabled, no `any` types
- **ESLint + Prettier**: Automated formatting and linting
- **Path Aliases**: Use `@services`, `@dtos`, etc. (never relative imports)
- **Error Handling**: Comprehensive try-catch with proper logging
- **Validation**: All inputs validated with class-validator DTOs

### **Naming Conventions**
```typescript
// Files: kebab-case
user.service.ts
auth.controller.ts
create-user.dto.ts

// Classes: PascalCase
export class UserService {}
export class AuthController {}
export class CreateUserDto {}

// Variables/Functions: camelCase
const firstName = 'John';
const createUser = async () => {};

// Constants: UPPER_SNAKE_CASE
const JWT_SECRET = 'secret';
const DATABASE_URL = 'postgresql://...';

// Interfaces: PascalCase with 'I' prefix
interface IUser {}
interface IConfig {}
```

## 📁 Import Organization

### **Import Order**
```typescript
// 1. External imports (Node.js, npm packages)
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 2. Internal imports (using path aliases)
import { PrismaService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { UserDto } from '@dtos';

// 3. Local imports (same directory)
import { UserRepository } from './user.repository';
```

### **Path Aliases Usage**
```typescript
// ✅ DO - Use path aliases
import { UserService } from '@services/users';
import { PrismaService } from '@infrastructure/database';
import { AuthDto } from '@dtos';
import { QRUtils } from '@utils/QR';

// ❌ DON'T - Use relative imports
import { UserService } from '../../../services/users/user.service';
import { PrismaService } from '../../infrastructure/database/src/prisma/prisma.service';
```

## 🔧 Service Patterns

### **Standard Service Structure**
```typescript
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggingService,
    private readonly cache: RedisService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    try {
      const user = await this.prisma.healthcare.user.create({ data });
      
      // Emit event for other services
      this.eventEmitter.emit('user.created', { user });
      
      // Cache the result
      await this.cache.set(`user:${user.id}`, JSON.stringify(user), 3600);
      
      this.logger.info('User created successfully', { userId: user.id });
      return user;
    } catch (error) {
      this.logger.error('Failed to create user', {
        error: error.message,
        stack: error.stack,
        data
      });
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      // Check cache first
      const cached = await this.cache.get(`user:${id}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Query database
      const user = await this.prisma.healthcare.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true
        }
      });

      // Cache result
      if (user) {
        await this.cache.set(`user:${id}`, JSON.stringify(user), 3600);
      }

      return user;
    } catch (error) {
      this.logger.error('Failed to find user', { error: error.message, userId: id });
      throw error;
    }
  }
}
```

## 🌐 Controller Patterns

### **Standard Controller Structure**
```typescript
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async create(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    return this.userService.create(createUserDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ): Promise<UserResponseDto> {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 204, description: 'User deleted successfully' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.userService.remove(id);
  }
}
```

## 📋 DTO Patterns

### **DTO Structure with Validation**
```typescript
import { IsString, IsEmail, IsOptional, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'User full name', example: 'John Doe' })
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => value?.trim())
  name: string;

  @ApiProperty({ description: 'User email address', example: 'john@example.com' })
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ description: 'User password', example: 'Password123!' })
  @IsString()
  @Length(8, 100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain uppercase, lowercase, number and special character'
  })
  password: string;

  @ApiPropertyOptional({ description: 'User phone number', example: '+1234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone?: string;
}

// Use mapped types for consistency
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const)
) {}

export class UserResponseDto extends IntersectionType(
  BaseEntityDto,
  OmitType(CreateUserDto, ['password'] as const)
) {}
```

## 🚫 Error Handling

### **Comprehensive Error Handling**
```typescript
// Custom exception classes
export class BusinessRuleException extends HttpException {
  constructor(message: string, code?: string) {
    super({
      message,
      code,
      timestamp: new Date().toISOString(),
    }, HttpStatus.BAD_REQUEST);
  }
}

// Service error handling
async createUser(data: CreateUserDto): Promise<User> {
  try {
    // Check business rules
    const existingUser = await this.findByEmail(data.email);
    if (existingUser) {
      throw new BusinessRuleException('Email already exists', 'EMAIL_EXISTS');
    }

    const user = await this.prisma.healthcare.user.create({ data });
    
    this.logger.info('User created successfully', {
      userId: user.id,
      email: data.email
    });
    
    return user;
  } catch (error) {
    if (error instanceof BusinessRuleException) {
      throw error; // Re-throw business rule exceptions
    }

    this.logger.error('Failed to create user', {
      error: error.message,
      stack: error.stack,
      email: data.email
    });

    throw new InternalServerErrorException('Failed to create user');
  }
}
```

## 📝 Logging Standards

### **Structured Logging**
```typescript
// ✅ DO - Structured logging with context
this.logger.info('User operation completed', {
  operation: 'create',
  userId: user.id,
  email: user.email,
  duration: Date.now() - startTime
});

this.logger.error('Database operation failed', {
  operation: 'findUser',
  userId,
  error: error.message,
  stack: error.stack,
  query: 'user.findUnique'
});

// ❌ DON'T - Plain string logging
console.log('User created');
this.logger.info('Error occurred: ' + error.message);
```

## 🔧 Code Quality Rules

### **Function Guidelines**
- **Single Responsibility**: One function, one purpose
- **Function Length**: Keep under 50 lines ideally
- **Parameter Count**: Maximum 4 parameters, use objects for more
- **Return Types**: Always specify return types
- **Async/Await**: Use async/await instead of Promises

### **Class Guidelines**
- **Constructor Injection**: Use dependency injection
- **Private Methods**: Mark internal methods as private
- **Method Ordering**: Public methods first, then private
- **Class Size**: Keep classes focused and under 300 lines

### **Comments and Documentation**
```typescript
/**
 * Creates a new user with validation and business rule checks
 * @param data - User creation data
 * @returns Promise<User> - Created user object
 * @throws BusinessRuleException - When email already exists
 * @throws ValidationException - When input data is invalid
 */
async createUser(data: CreateUserDto): Promise<User> {
  // Business logic here
}

// Use inline comments for complex logic
const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds: 10
```

## 🚫 Anti-Patterns to Avoid

### **❌ Don't Do This**
```typescript
// Don't use any type
function processData(data: any): any {
  return data;
}

// Don't use console.log
console.log('Debug info');

// Don't ignore errors
const user = await this.userService.create(data); // No try-catch

// Don't use relative imports
import { UserService } from '../../../services/users/user.service';

// Don't hardcode values
const PORT = 4000;
const SECRET = 'hardcoded-secret';

// Don't skip validation
@Post()
async create(@Body() data: any) {
  // No DTO validation
}
```

### **✅ Do This Instead**
```typescript
// Use proper types
function processData(data: ProcessDataDto): ProcessedDataDto {
  return transformData(data);
}

// Use proper logging
this.logger.info('Debug info', { context: 'UserService' });

// Handle errors properly
try {
  const user = await this.userService.create(data);
  return user;
} catch (error) {
  this.logger.error('Failed to create user', error);
  throw error;
}

// Use path aliases
import { UserService } from '@services/users';

// Use configuration
constructor(private configService: ConfigService) {
  const port = this.configService.get<number>('port');
  const secret = this.configService.get<string>('jwt.secret');
}

// Use proper DTOs
@Post()
async create(@Body() createUserDto: CreateUserDto) {
  return this.userService.create(createUserDto);
}
```

---

**💡 Remember**: These standards ensure code consistency, maintainability, and reliability across the healthcare system.

**Last Updated**: December 2024
