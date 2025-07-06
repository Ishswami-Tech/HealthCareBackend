import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { PermissionGuard } from './permission.guard';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PermissionService } from '../../shared/permissions/permission.service';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingModule,
  ],
  providers: [
    JwtAuthGuard, 
    RolesGuard, 
    ClinicGuard, 
    PermissionGuard,
    PermissionService,
    Reflector
  ],
  exports: [JwtAuthGuard, RolesGuard, ClinicGuard, PermissionGuard],
})
export class GuardsModule {} 