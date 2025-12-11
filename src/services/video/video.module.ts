/**
 * Video Module
 * @class VideoModule
 * @description Standalone video service module
 * Can be used by appointments and other services
 * Microservice-ready design
 */

import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HttpModule } from '@nestjs/axios';
import { TerminusModule } from '@nestjs/terminus';
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
import { CommunicationModule } from '@communication/communication.module';
import { HealthModule } from '@services/health/health.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';
// Video providers
import { VideoProviderFactory } from './providers/video-provider.factory';
import { OpenViduVideoProvider } from './providers/openvidu-video.provider';
import { JitsiVideoProvider } from './providers/jitsi-video.provider';
// Webhook handlers (optimized architecture)
import { OpenViduWebhookController } from './webhooks/openvidu-webhook.controller';
import { OpenViduWebhookService } from './webhooks/openvidu-webhook.service';
// Health indicators - all from central HealthModule
import { VideoHealthIndicator } from '@services/health/health-indicators';

@Module({
  imports: [
    ConfigModule,
    HttpModule, // HTTP client for OpenVidu API calls
    TerminusModule, // Health checks
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    DatabaseModule, // Required for database operations
    CommunicationModule, // Required for CommunicationHealthIndicator
    HealthModule, // Central health module with shared health indicators
    SocketModule,
    GuardsModule,
    RbacModule,
    ErrorsModule, // Error handling
    RateLimitModule, // Rate limiting
  ],
  controllers: [
    VideoController,
    OpenViduWebhookController, // Webhook handler for OpenVidu events (optimized architecture)
  ],
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
    // Webhook service (processes OpenVidu webhooks and forwards to Socket.IO)
    OpenViduWebhookService,
    // Note: VideoHealthIndicator is provided by HealthModule (imported above)
    // It's exported from HealthModule and available for injection
  ],
  exports: [
    // Export video service for other modules to use
    VideoService,
    // Export tracker for advanced use cases
    VideoConsultationTracker,
  ],
})
export class VideoModule {}
