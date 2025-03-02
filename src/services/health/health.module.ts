import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { RedisService } from '../../shared/cache/redis/redis.service';
import { KafkaService } from '../../shared/messaging/kafka/kafka.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService, KafkaService],
})
export class HealthModule {} 