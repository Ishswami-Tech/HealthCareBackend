import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventsModule } from '@infrastructure/events';
import { LoggingModule } from '@infrastructure/logging';
import { QueueMonitoringService } from './queue-monitoring.service';

/**
 * Queue Monitoring Module
 *
 * Provides enterprise-grade monitoring and alerting for queue infrastructure.
 * Includes real-time metrics, health checks, and performance analytics.
 */
@Module({
  imports: [
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    LoggingModule,
  ],
  providers: [QueueMonitoringService],
  exports: [QueueMonitoringService],
})
export class QueueMonitoringModule {}
