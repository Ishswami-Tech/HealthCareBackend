import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../shared/logging/logging.module';

@Module({
  imports: [
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingModule,
  ],
  providers: [JwtAuthGuard, RolesGuard, ClinicGuard],
  exports: [JwtAuthGuard, RolesGuard, ClinicGuard],
})
export class GuardsModule {} 