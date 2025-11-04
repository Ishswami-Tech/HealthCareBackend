// External imports
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Internal imports - Infrastructure
import { LoggingModule } from '@infrastructure/logging';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';

// Internal imports - Local
import { EventService } from './event.service';
import { EnterpriseEventService } from './enterprise.event.service';

@Module({
  imports: [LoggingModule, RedisModule, EventEmitterModule.forRoot()],
  providers: [EventService, EnterpriseEventService],
  exports: [EventService, EnterpriseEventService],
})
export class EventsModule {}
