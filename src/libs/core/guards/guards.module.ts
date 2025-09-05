import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../utils/rate-limit/rate-limit.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { LoggingServiceModule } from '../../infrastructure/logging';
import { LoggingService } from '../../infrastructure/logging/logging.service';
import { RbacModule } from '../rbac/rbac.module';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [
    JwtModule,
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingServiceModule,
    RbacModule,
  ],
  providers: [
    JwtAuthGuard, 
    RolesGuard, 
    ClinicGuard, 
    RbacGuard,
    Reflector,
    LoggingService
  ],
  exports: [JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, LoggingService, JwtModule, RateLimitModule],
})
export class GuardsModule {} 