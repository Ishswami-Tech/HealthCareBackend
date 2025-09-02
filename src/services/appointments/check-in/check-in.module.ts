import { Module } from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { CheckInController } from './check-in.controller';
import { PrismaModule } from '../../../libs/infrastructure/database/prisma/prisma.module';
import { LoggingModule } from '../../../libs/infrastructure/logging/logging.module';
import { QueueModule } from '../../../libs/infrastructure/queue/queue.module';
import { SocketModule } from '../../../libs/communication/socket/socket.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { GuardsModule } from '../../../libs/core/guards/guards.module';
import { RateLimitModule } from '../../../libs/utils/rate-limit/rate-limit.module';
import { AuthModule } from '../../../services/auth/auth.module';
import { RedisModule } from '../../../libs/infrastructure/cache/redis/redis.module';
import { PermissionsModule } from '../../../libs/infrastructure/permissions';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    QueueModule.register(),
    SocketModule,
    GuardsModule,
    RateLimitModule,
    AuthModule,
    RedisModule,
    EventEmitterModule.forRoot(),
    PermissionsModule,
  ],
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {} 