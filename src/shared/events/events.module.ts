import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { LoggingModule } from '../logging/logging.module';
import { RedisModule } from '../cache/redis/redis.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    LoggingModule,
    RedisModule,
    EventEmitterModule.forRoot()
  ],
  providers: [EventService],
  exports: [EventService],
})
export class EventsModule {} 