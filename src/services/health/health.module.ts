import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
// TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
import { ConfigModule } from '@config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
// Use direct import to avoid circular dependency with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/channels/socket';
import { ErrorsModule } from '@core/errors';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';
import { VideoModule } from '@services/video/video.module';
// Health indicators
import { DatabaseHealthIndicator } from './health-indicators/database-health.indicator';
import { CacheHealthIndicator } from './health-indicators/cache-health.indicator';
import { QueueHealthIndicator } from './health-indicators/queue-health.indicator';
import { LoggingHealthIndicator } from './health-indicators/logging-health.indicator';
import { VideoHealthIndicator } from './health-indicators/video-health.indicator';
// Realtime health services
import { RealtimeHealthGateway } from './realtime/realtime-health.gateway';
import { SystemHealthChecker } from './realtime/checkers/system-health.checker';
import { SocketHealthChecker } from './realtime/checkers/socket-health.checker';
import { HealthAggregatorService } from './realtime/services/health-aggregator.service';
import { HealthCacheService } from './realtime/services/health-cache.service';
import { ChangeDetectorService } from './realtime/services/change-detector.service';
import { HealthSchedulerService } from './realtime/services/health-scheduler.service';
import { HealthBroadcasterService } from './realtime/services/health-broadcaster.service';

@Module({
  imports: [
    ConfigModule, // Explicitly import ConfigModule to ensure ConfigService is available
    HttpModule, // HTTP client for health checks
    // TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
    forwardRef(() => DatabaseModule), // Use forwardRef to break circular dependency
    CacheModule,
    QueueModule,
    LoggingModule,
    SocketModule,
    ErrorsModule,
    // VideoModule imported with forwardRef to break circular dependency
    // This ensures VideoService is available for VideoHealthIndicator
    forwardRef(() => VideoModule),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    // Health indicators (no Terminus dependency - uses only LoggingService)
    DatabaseHealthIndicator,
    CacheHealthIndicator,
    QueueHealthIndicator,
    LoggingHealthIndicator,
    VideoHealthIndicator,
    // Realtime health services
    RealtimeHealthGateway,
    // Health checkers (only System and Socket - others use HealthService)
    SystemHealthChecker,
    SocketHealthChecker,
    // Core services
    HealthAggregatorService,
    HealthCacheService,
    ChangeDetectorService,
    HealthSchedulerService,
    HealthBroadcasterService,
  ],
  exports: [
    HealthService,
    // Export health indicators for use in other modules
    DatabaseHealthIndicator,
    CacheHealthIndicator,
    QueueHealthIndicator,
    LoggingHealthIndicator,
    VideoHealthIndicator,
    // Export realtime health services
    RealtimeHealthGateway,
    HealthSchedulerService,
    HealthBroadcasterService,
  ],
})
export class HealthModule {}
