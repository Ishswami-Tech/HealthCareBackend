import { Module } from "@nestjs/common";
import { RbacService } from "./rbac.service";
import { RoleService } from "./role.service";
import { PermissionService } from "./permission.service";
import { RbacGuard } from "./rbac.guard";
import { RbacDecorators } from "./rbac.decorators";
import { PrismaModule } from "../../infrastructure/database/prisma/prisma.module";
import { RedisModule } from "../../infrastructure/cache/redis/redis.module";
import { LoggingServiceModule } from "../../infrastructure/logging";

@Module({
  imports: [PrismaModule, RedisModule, LoggingServiceModule],
  providers: [
    RbacService,
    RoleService,
    PermissionService,
    RbacGuard,
    RbacDecorators,
  ],
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
