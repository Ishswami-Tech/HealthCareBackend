import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@config';

// Core modules
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';
import { SessionModule } from '@core/session/session.module';
import { GuardsModule } from '@core/guards/guards.module';
import { EmailModule } from '@communication/channels/email/email.module';
import { LoggingModule } from '@infrastructure/logging';

// Auth services
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

// Core auth services
import { JwtAuthService } from './core/jwt.service';
import { OtpService } from './core/otp.service';
import { PasswordService } from './core/password.service';
import { SocialAuthService } from './core/social-auth.service';
import { SignOptions } from 'jsonwebtoken';

// Guards - using shared guards from libs

@Module({
  imports: [
    ConfigModule, // Ensure ConfigModule is imported for ConfigService availability
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const expiresIn: string =
          configService?.get<string>(
            'JWT_ACCESS_EXPIRES_IN',
            process.env['JWT_ACCESS_EXPIRES_IN'] || '24h'
          ) || '24h';
        return {
          secret:
            configService?.get<string>(
              'JWT_SECRET',
              process.env['JWT_SECRET'] || 'dev-jwt-secret-key'
            ) || 'dev-jwt-secret-key',
          signOptions: {
            expiresIn: expiresIn as SignOptions['expiresIn'],
          } as SignOptions,
        };
      },
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
    // Note: HealthcareCacheInterceptor is provided globally by CacheModule
    // No need to register it here to avoid duplicate instances
  ],
  exports: [AuthService, JwtAuthService, OtpService, PasswordService, SocialAuthService],
})
export class AuthModule implements OnModuleInit {
  constructor() {}

  onModuleInit() {
    // Module initialization complete
  }
}
