import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

// Core modules
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';
import { SessionModule } from '@core/session/session.module';
import { GuardsModule } from '@core/guards/guards.module';
import { EmailModule } from '@communication/messaging/email/email.module';
import { LoggingModule } from '@infrastructure/logging';

// Cache interceptor
import { HealthcareCacheInterceptor } from '@infrastructure/cache/interceptors/healthcare-cache.interceptor';

// Auth services
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

// Core auth services
import { JwtAuthService } from './core/jwt.service';
import { OtpService } from './core/otp.service';
import { PasswordService } from './core/password.service';
import { SocialAuthService } from './core/social-auth.service';

// Guards - using shared guards from libs

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    CacheModule,
    EventsModule,
    RbacModule,
    SessionModule,
    GuardsModule,
    EmailModule,
    LoggingModule,
  ],
  controllers: [AuthController],
  providers: [
    // Main auth service
    AuthService,

    // Core auth services
    JwtAuthService,
    OtpService,
    PasswordService,
    SocialAuthService,

    // Healthcare cache interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: HealthcareCacheInterceptor,
    },
  ],
  exports: [AuthService, JwtAuthService, OtpService, PasswordService, SocialAuthService],
})
export class AuthModule implements OnModuleInit {
  constructor() {}

  onModuleInit() {
    // Module initialization complete
  }
}
