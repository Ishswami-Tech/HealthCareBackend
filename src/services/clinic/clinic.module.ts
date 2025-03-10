import { Module } from '@nestjs/common';

import { ClinicDatabaseService } from './clinic-database.service';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule
  ],
  controllers: [ClinicController],
  providers: [ClinicService, ClinicDatabaseService],
  exports: [ClinicService, ClinicDatabaseService],
})
export class ClinicModule {} 