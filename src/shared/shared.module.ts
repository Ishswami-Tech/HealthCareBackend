import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { LoggingService } from './logging/logging.service';
import { EventService } from './events/event.service';
import { PrismaModule } from './database/prisma/prisma.module';
import { RedisModule } from './cache/redis/redis.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
  ],
  providers: [LoggingService, EventService],
  exports: [LoggingService, EventService],
})
export class SharedModule {} 