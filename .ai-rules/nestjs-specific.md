# 🚀 NestJS & Fastify Guidelines

## 🎯 Framework Essentials

### **Platform Configuration**
```typescript
// ✅ DO - Use Fastify (NOT Express)
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  
  await app.listen(8088, '0.0.0.0');
}

// ❌ DON'T - Use Express
import { NestExpressApplication } from '@nestjs/platform-express';
```

### **Module Structure**
```typescript
@Module({
  imports: [
    // External modules
    ConfigModule.forRoot(),
    TypeOrmModule.forRoot(),
    
    // Internal modules
    DatabaseModule,
    AuthModule,
    UserModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global providers
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    }
  ],
  exports: [AppService]
})
export class AppModule {}
```

## 🔧 Dependency Injection Patterns

### **Constructor Injection**
```typescript
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService,
    private readonly cache: RedisService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService
  ) {}

  // Service methods
}
```

### **Provider Configuration**
```typescript
@Module({
  providers: [
    // Class provider
    UserService,
    
    // Value provider
    {
      provide: 'API_CONFIG',
      useValue: {
        version: '1.0.0',
        timeout: 5000
      }
    },
    
    // Factory provider
    {
      provide: 'DATABASE_CONNECTION',
      useFactory: async (configService: ConfigService) => {
        const config = configService.get('database');
        return createConnection(config);
      },
      inject: [ConfigService]
    },
    
    // Async provider
    {
      provide: 'ASYNC_SERVICE',
      useFactory: async () => {
        const service = new ExternalService();
        await service.initialize();
        return service;
      }
    }
  ]
})
export class UserModule {}
```

## 🛡️ Guards Implementation

### **Authentication Guard**
```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    // Check for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (isPublic) {
      return true;
    }
    
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
```

### **Role-Based Guard**
```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// Usage in controllers
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Post('users')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async createUser(@Body() createUserDto: CreateUserDto) {
    // Only admins can access
  }
}
```

## 🔄 Interceptors

### **Logging Interceptor**
```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;
    const startTime = Date.now();

    this.logger.info('Request started', {
      method,
      url,
      userId: user?.id,
      body: this.sanitizeBody(body)
    });

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        this.logger.info('Request completed', {
          method,
          url,
          duration,
          userId: user?.id,
          responseSize: JSON.stringify(data).length
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error('Request failed', {
          method,
          url,
          duration,
          userId: user?.id,
          error: error.message,
          stack: error.stack
        });
        throw error;
      })
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    const sanitized = { ...body };
    // Remove sensitive fields
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    
    return sanitized;
  }
}
```

### **Transform Interceptor**
```typescript
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
        path: context.switchToHttp().getRequest().url
      }))
    );
  }
}

interface Response<T> {
  success: boolean;
  data: T;
  timestamp: string;
  path: string;
}
```

## 🔧 Pipes & Validation

### **Global Validation Pipe**
```typescript
// In main.ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true, // Strip unknown properties
    forbidNonWhitelisted: true, // Throw error for unknown properties
    transform: true, // Transform payloads to DTO instances
    transformOptions: {
      enableImplicitConversion: true, // Convert string to number automatically
    },
    exceptionFactory: (errors: ValidationError[]) => {
      const formattedErrors = errors.map(error => ({
        field: error.property,
        constraints: error.constraints,
        value: error.value
      }));
      
      return new BadRequestException({
        message: 'Validation failed',
        errors: formattedErrors
      });
    }
  })
);
```

### **Custom Validation Pipe**
```typescript
@Injectable()
export class ParseUUIDPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!value) {
      throw new BadRequestException('UUID is required');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(value)) {
      throw new BadRequestException('Invalid UUID format');
    }

    return value;
  }
}

// Usage
@Get(':id')
async findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.userService.findById(id);
}
```

## 🔄 Exception Filters

### **Global Exception Filter**
```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).errors || null;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      ...(details && { details })
    };

    this.logger.error('Exception caught', {
      error: exception,
      request: {
        method: request.method,
        url: request.url,
        userAgent: request.get('user-agent'),
        userId: request.user?.id
      },
      response: errorResponse
    });

    response.status(status).json(errorResponse);
  }
}
```

## 🔧 Middleware

### **Context Middleware**
```typescript
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Add request ID for tracing
    req['requestId'] = uuidv4();
    
    // Add clinic/studio context from headers
    const clinicId = req.headers['x-clinic-id'] as string;
    const studioId = req.headers['x-studio-id'] as string;
    
    if (clinicId) {
      req['clinicId'] = clinicId;
    }
    
    if (studioId) {
      req['studioId'] = studioId;
    }

    next();
  }
}

// Apply middleware
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ContextMiddleware)
      .forRoutes('*');
  }
}
```

## 📝 Decorators

### **Custom Decorators**
```typescript
// Public route decorator
export const Public = () => SetMetadata('isPublic', true);

// Roles decorator
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// Current user decorator
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// Clinic context decorator
export const ClinicContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return {
      clinicId: request.clinicId,
      userId: request.user?.id
    };
  },
);

// Usage in controllers
@Controller('users')
export class UserController {
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    return user;
  }

  @Post('public')
  @Public()
  async publicEndpoint() {
    // No authentication required
  }

  @Post('admin')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async adminEndpoint(@ClinicContext() context: { clinicId: string; userId: string }) {
    // Admin only with clinic context
  }
}
```

## 🔄 Event Handling

### **Event Emitter Setup**
```typescript
// In app.module.ts
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    })
  ]
})
export class AppModule {}

// Service with events
@Injectable()
export class UserService {
  constructor(private eventEmitter: EventEmitter2) {}

  async createUser(data: CreateUserDto): Promise<User> {
    const user = await this.userRepository.create(data);
    
    // Emit event
    this.eventEmitter.emit('user.created', {
      user,
      timestamp: new Date(),
      source: 'UserService'
    });
    
    return user;
  }
}

// Event listener
@Injectable()
export class UserEventListener {
  @OnEvent('user.created')
  async handleUserCreated(payload: { user: User; timestamp: Date; source: string }) {
    // Handle user creation event
    await this.sendWelcomeEmail(payload.user);
    await this.createUserProfile(payload.user);
  }

  @OnEvent('user.*.updated') // Wildcard pattern
  async handleUserUpdated(payload: any) {
    // Handle any user update event
  }
}
```

## 🚫 Anti-Patterns to Avoid

### **❌ Don't Do This**
```typescript
// Don't use Express
import { NestExpressApplication } from '@nestjs/platform-express';

// Don't inject services directly in constructors without interfaces
constructor(private userService: UserService) {} // Tight coupling

// Don't use any in guards
canActivate(context: any): boolean { // Use proper types

// Don't ignore error handling in interceptors
intercept(context: ExecutionContext, next: CallHandler) {
  return next.handle(); // No error handling
}

// Don't use console.log in interceptors
console.log('Request received'); // Use proper logging
```

### **✅ Do This Instead**
```typescript
// Use Fastify
import { NestFastifyApplication } from '@nestjs/platform-fastify';

// Use interfaces for loose coupling
constructor(private userService: IUserService) {}

// Use proper types
canActivate(context: ExecutionContext): boolean | Promise<boolean> {

// Handle errors in interceptors
intercept(context: ExecutionContext, next: CallHandler) {
  return next.handle().pipe(
    catchError(error => {
      this.logger.error('Request failed', error);
      throw error;
    })
  );
}

// Use proper logging
this.logger.info('Request received', { context: 'LoggingInterceptor' });
```

---

**💡 These NestJS patterns ensure proper framework usage, maintainable code, and optimal performance with Fastify.**

**Last Updated**: December 2024
