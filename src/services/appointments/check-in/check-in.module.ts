import { Module } from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { CheckInController } from './check-in.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { QueueModule } from '../../../shared/queue/queue.module';
import { SocketModule } from '../../../shared/socket/socket.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { GuardsModule } from '../../../libs/guards/guards.module';
import { RateLimitModule } from '../../../shared/rate-limit/rate-limit.module';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    QueueModule.register(),
    SocketModule,
    GuardsModule,
    RateLimitModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {} 