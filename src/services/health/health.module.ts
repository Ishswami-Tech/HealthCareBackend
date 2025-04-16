import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class HealthModule {} 