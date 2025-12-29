/**
 * Video Module
 * @class VideoModule
 * @description Standalone video service module
 * Can be used by appointments and other services
 * Microservice-ready design
 */

import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@config';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { HttpModule } from '@infrastructure/http';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { EventsModule } from '@infrastructure/events';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { ErrorsModule } from '@core/errors/errors.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { CommunicationModule } from '@communication/communication.module';
import { QueueModule } from '@queue/src/queue.module';
import { StorageModule } from '@infrastructure/storage';
// Note: HealthModule is imported with forwardRef to break circular dependency
// since HealthModule also imports VideoModule with forwardRef
import { HealthModule } from '@services/health/health.module';
import { EHRModule } from '@services/ehr/ehr.module';
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
// New feature services
import { VideoChatService } from './services/video-chat.service';
import { VideoWaitingRoomService } from './services/video-waiting-room.service';
import { VideoMedicalNotesService } from './services/video-medical-notes.service';
import { VideoAnnotationService } from './services/video-annotation.service';
import { VideoTranscriptionService } from './services/video-transcription.service';
import { VideoQualityService } from './services/video-quality.service';
import { VideoVirtualBackgroundService } from './services/video-virtual-background.service';
// Note: HealthModule and VideoModule have a circular dependency.
// Both use forwardRef to break the cycle. HealthModule provides VideoHealthIndicator
// which is injected into VideoController for health check endpoints.

@Module({
  imports: [
    ConfigModule,
    HttpModule, // Centralized HTTP service for OpenVidu API calls
    TerminusModule, // Health checks
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    DatabaseModule, // Required for database operations
    CommunicationModule, // Required for CommunicationHealthIndicator
    // HealthModule imported with forwardRef to break circular dependency
    // Provides VideoHealthIndicator and other health indicators for VideoController
    forwardRef(() => HealthModule),
    SocketModule,
    GuardsModule,
    RbacModule,
    ErrorsModule, // Error handling
    RateLimitModule, // Rate limiting
    QueueModule, // Queue processing for recording processing, transcoding, analytics
    StorageModule, // File storage for virtual backgrounds and other assets
    forwardRef(() => EHRModule), // EHR integration for medical notes and transcriptions
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
    // New feature services
    VideoChatService,
    VideoWaitingRoomService,
    VideoMedicalNotesService,
    VideoAnnotationService,
    VideoTranscriptionService,
    VideoQualityService,
    VideoVirtualBackgroundService,
  ],
  exports: [
    // Export video service for other modules to use
    VideoService,
    // Export tracker for advanced use cases
    VideoConsultationTracker,
    // Export new feature services
    VideoChatService,
    VideoWaitingRoomService,
    VideoMedicalNotesService,
    VideoAnnotationService,
    VideoTranscriptionService,
    VideoQualityService,
    VideoVirtualBackgroundService,
  ],
})
export class VideoModule {}
