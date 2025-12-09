/**
 * Video Module
 * @class VideoModule
 * @description Standalone video service module
 * Can be used by appointments and other services
 * Microservice-ready design
 */

import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@config';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { EventsModule } from '@infrastructure/events';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { ErrorsModule } from '@core/errors/errors.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';
// Video providers
import { VideoProviderFactory } from './providers/video-provider.factory';
import { OpenViduVideoProvider } from './providers/openvidu-video.provider';
import { JitsiVideoProvider } from './providers/jitsi-video.provider';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    DatabaseModule, // Required for database operations
    SocketModule,
    GuardsModule,
    RbacModule,
    ErrorsModule, // Error handling
    RateLimitModule, // Rate limiting
  ],
  controllers: [VideoController],
  providers: [
    // Video providers must be listed BEFORE VideoProviderFactory (which depends on them)
    OpenViduVideoProvider, // Primary provider (OpenVidu)
    JitsiVideoProvider, // Fallback provider (Jitsi)
    // Video providers factory (depends on OpenViduVideoProvider and JitsiVideoProvider)
    VideoProviderFactory,
    // Single consolidated video service (depends on VideoProviderFactory)
    VideoService,
    // Other services
    VideoConsultationTracker,
  ],
  exports: [
    // Export video service for other modules to use
    VideoService,
    // Export tracker for advanced use cases
    VideoConsultationTracker,
  ],
})
export class VideoModule {}

