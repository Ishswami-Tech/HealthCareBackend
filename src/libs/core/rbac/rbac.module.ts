import { Module, forwardRef } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { RbacGuard } from './rbac.guard';
import { RbacDecorators } from './rbac.decorators';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';

@Module({
  imports: [DatabaseModule, forwardRef(() => CacheModule), LoggingModule],
  providers: [RbacService, RoleService, PermissionService, RbacGuard, RbacDecorators],
  exports: [
    RbacService,
    RoleService,
    PermissionService,
    RbacGuard,
    RbacDecorators,
    // Export all types and interfaces for easy importing
  ],
})
export class RbacModule {}
