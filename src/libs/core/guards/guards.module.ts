import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { PermissionGuard } from './permission.guard';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../utils/rate-limit/rate-limit.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { LoggingModule } from '../../infrastructure/logging/logging.module';
import { PermissionsModule } from '../../infrastructure/permissions/permissions.module';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingModule,
    PermissionsModule,
  ],
  providers: [
    JwtAuthGuard, 
    RolesGuard, 
    ClinicGuard, 
    PermissionGuard,
    Reflector
  ],
  exports: [JwtAuthGuard, RolesGuard, ClinicGuard, PermissionGuard],
})
export class GuardsModule {} 