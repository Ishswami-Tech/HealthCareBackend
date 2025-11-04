import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { RbacGuard } from './rbac.guard';
import { RbacDecorators } from './rbac.decorators';
import { DatabaseModule } from '@infrastructure/database';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
import { LoggingModule } from '@infrastructure/logging';

@Module({
  imports: [DatabaseModule, RedisModule, LoggingModule],
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
