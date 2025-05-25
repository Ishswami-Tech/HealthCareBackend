import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { SocketModule } from '../../shared/socket/socket.module';
import { EmailModule } from '../../shared/messaging/email/email.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    QueueModule.register(),
    LoggingModule,
    SocketModule,
    EmailModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {} 