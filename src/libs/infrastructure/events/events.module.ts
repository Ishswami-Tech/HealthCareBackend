import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { LoggingServiceModule } from '../logging';
import { RedisModule } from '../cache/redis/redis.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    LoggingServiceModule,
    RedisModule,
    EventEmitterModule.forRoot()
  ],
  providers: [EventService],
  exports: [EventService],
})
export class EventsModule {} 