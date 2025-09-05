import { Module } from '@nestjs/common';
import { CacheServiceModule } from '../../libs/infrastructure/cache/cache-service.module';
import { DatabaseModule } from '../../libs/infrastructure/database';
import { RbacModule } from '../../libs/core/rbac/rbac.module';

// Core auth services
import { BaseAuthService } from './core/base-auth.service';

// Auth plugins
import { ClinicAuthPlugin } from './plugins/clinic-auth.plugin';
import { SharedAuthPlugin } from './plugins/shared-auth.plugin';

@Module({
  imports: [
    CacheServiceModule,
    DatabaseModule,
    RbacModule,
  ],
  providers: [
    BaseAuthService,
    ClinicAuthPlugin,
    SharedAuthPlugin,
  ],
  exports: [
    BaseAuthService,
    ClinicAuthPlugin,
    SharedAuthPlugin,
  ],
})
export class AuthPluginsModule {}