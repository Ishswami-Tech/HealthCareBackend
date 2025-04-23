import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../shared/logging/logging.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingModule,
  ],
  providers: [JwtAuthGuard, RolesGuard, ClinicGuard],
  exports: [JwtAuthGuard, RolesGuard, ClinicGuard, JwtModule],
})
export class GuardsModule {} 