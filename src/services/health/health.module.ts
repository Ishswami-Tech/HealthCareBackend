import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
// Use direct import to avoid circular dependency with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/channels/socket';
import { EmailModule } from '@communication/channels/email';
import { ErrorsModule } from '@core/errors';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';
import { CommunicationModule } from '@communication/communication.module';
// Health indicators
import { DatabaseHealthIndicator } from './health-indicators/database-health.indicator';
import { CacheHealthIndicator } from './health-indicators/cache-health.indicator';
import { QueueHealthIndicator } from './health-indicators/queue-health.indicator';
import { LoggingHealthIndicator } from './health-indicators/logging-health.indicator';
import { CommunicationHealthIndicator } from './health-indicators/communication-health.indicator';
import { VideoHealthIndicator } from './health-indicators/video-health.indicator';

@Module({
  imports: [
    ConfigModule, // Explicitly import ConfigModule to ensure ConfigService is available
    HttpModule, // HTTP client for health checks
    TerminusModule, // Health checks framework
    forwardRef(() => DatabaseModule), // Use forwardRef to break circular dependency
    CacheModule,
    QueueModule,
    LoggingModule,
    CommunicationModule, // Import CommunicationModule to access CommunicationHealthMonitorService
    SocketModule,
    EmailModule,
    ErrorsModule,
    // Note: VideoModule is not imported here to avoid circular dependency
    // VideoHealthIndicator uses Optional injection, so VideoService will be available
    // if VideoModule is imported in the application root or other modules
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    // Health indicators for TerminusModule
    DatabaseHealthIndicator,
    CacheHealthIndicator,
    QueueHealthIndicator,
    LoggingHealthIndicator,
    CommunicationHealthIndicator,
    VideoHealthIndicator,
  ],
  exports: [
    HealthService,
    // Export health indicators for use in other modules
    DatabaseHealthIndicator,
    CacheHealthIndicator,
    QueueHealthIndicator,
    LoggingHealthIndicator,
    CommunicationHealthIndicator,
    VideoHealthIndicator,
  ],
})
export class HealthModule {}
