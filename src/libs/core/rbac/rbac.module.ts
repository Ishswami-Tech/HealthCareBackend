import { Module, forwardRef } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { RbacGuard } from './rbac.guard';
import { RbacDecorators } from './rbac.decorators';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
// CacheModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - LoggingService is available without explicit import

@Module({
  imports: [forwardRef(() => DatabaseModule)],
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
