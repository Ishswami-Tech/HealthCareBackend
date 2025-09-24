import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { QueueMonitoringService } from "./queue-monitoring.service";

/**
 * Queue Monitoring Module
 *
 * Provides enterprise-grade monitoring and alerting for queue infrastructure.
 * Includes real-time metrics, health checks, and performance analytics.
 */
@Module({
  imports: [EventEmitterModule],
  providers: [QueueMonitoringService],
  exports: [QueueMonitoringService],
})
export class QueueMonitoringModule {}
