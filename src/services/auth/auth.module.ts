import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheServiceModule } from '../../libs/infrastructure/cache/cache-service.module';
import { DatabaseModule } from '../../libs/infrastructure/database';
import { RbacModule } from '../../libs/core/rbac/rbac.module';
import { SessionModule } from '../../libs/core/session/session.module';
import { ResilienceModule } from '../../libs/core/resilience/resilience.module';
import { GuardsModule } from '../../libs/core/guards/guards.module';
import { EmailModule } from '../../libs/communication/messaging/email/email.module';
import { ModuleRef } from '@nestjs/core';

// Core auth services
import { BaseAuthService } from './core/base-auth.service';
import { PluginManagerService } from './core/plugin-manager.service';

// Auth plugins
import { ClinicAuthPlugin } from './plugins/clinic-auth.plugin';
import { SharedAuthPlugin } from './plugins/shared-auth.plugin';

// Auth implementations
import { ClinicAuthService } from './implementations/clinic-auth.service';

// Services
import { SessionService } from './services/session.service';

// Controllers
import { AuthController } from './controllers/auth.controller';
import { ClinicAuthController } from './controllers/clinic-auth.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h',
        },
      }),
      inject: [ConfigService],
    }),
    CacheServiceModule,
    DatabaseModule,
    forwardRef(() => RbacModule),
    SessionModule,
    ResilienceModule,
    GuardsModule,
    EmailModule,
  ],
  controllers: [AuthController, ClinicAuthController],
  providers: [
    // Foundation services first (no dependencies)
    BaseAuthService,
    
    // Plugin manager (initialized first, discovers plugins later)
    PluginManagerService,
    
    // Auth plugins (depend on BaseAuthService, no circular deps)
    ClinicAuthPlugin,
    SharedAuthPlugin,
    
    // High-level services (depend on plugin manager)
    ClinicAuthService,
    
    // Session management
    SessionService,
  ],
  exports: [
    BaseAuthService,
    PluginManagerService,
    ClinicAuthService,
    SessionService,
  ],
})
export class AuthModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly pluginManager: PluginManagerService,
  ) {}

  async onModuleInit() {
    // Register plugins after all dependencies are available
    try {
      const clinicPlugin = this.moduleRef.get(ClinicAuthPlugin);
      const sharedPlugin = this.moduleRef.get(SharedAuthPlugin);

      await this.pluginManager.registerPlugin(clinicPlugin);
      await this.pluginManager.registerPlugin(sharedPlugin);
      
      console.log('✅ Auth plugins registered successfully');
    } catch (error) {
      console.error('❌ Failed to register auth plugins:', error);
    }
  }
}
