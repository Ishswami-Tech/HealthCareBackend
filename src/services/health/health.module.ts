import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../../libs/infrastructure/database/prisma/prisma.module';
import { RedisModule } from '../../libs/infrastructure/cache/redis/redis.module';
import { QueueModule } from '../../libs/infrastructure/queue/queue.module';
import { LoggingModule } from '../../libs/infrastructure/logging/logging.module';
import { SocketModule } from '../../libs/communication/socket/socket.module';
import { EmailModule } from '../../libs/communication/messaging/email/email.module';

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